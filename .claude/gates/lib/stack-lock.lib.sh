#!/bin/bash
# stack-lock.lib.sh — deterministic stack-lock checks shared by phase gates.
#
# WHY: the generate-prd / pipeline tech-stack rule is prompt-level, so a long PRD
# can make the model "forget" it (LLM randomness). These checks are deterministic:
# no LLM — they read the machine-readable forbidden/required lists from
# rules/stacks/stack-lock.json and scan a layer's package.json with jq.
#
# Generic by design: no library name lives in this file. The lists are data
# (stack-lock.json), keyed by stack. An unknown/unlisted stack is a no-op.
#
# Sourced by backend-gate.sh and frontend-gate.sh. Requires: jq.
#
# NOTE: results are appended directly to CHECKS_JSON (the gate-runner pattern used
# by backend-gate.sh's manual checks) rather than via run_check, because
# _gate-runner.sh's run_check has a pre-existing bug: `output=$(eval "$cmd") || true`
# resets ${PIPESTATUS[0]} to 0, so a non-expect run_check always reports pass.
# stack_lock_emit_checks therefore computes pass/fail itself.

# stack_lock_resolve_stack <target_dir> <backend|frontend> <default>
# Reads the stack key from PIPELINE_STATUS.md tech_stack; falls back to <default>.
stack_lock_resolve_stack() {
  local target="$1" layer="$2" def="$3"
  local status_file
  status_file=$(ls "$target"/.claude-project/*/status/PIPELINE_STATUS.md 2>/dev/null | head -1)
  [ -z "$status_file" ] && { echo "$def"; return 0; }
  local val=""
  if [ "$layer" = "backend" ]; then
    val=$(grep -aE '^[[:space:]]*backend:[[:space:]]*[A-Za-z0-9_-]+' "$status_file" 2>/dev/null \
      | head -1 | sed -E 's/.*backend:[[:space:]]*([A-Za-z0-9_-]+).*/\1/')
  else
    val=$(grep -aE '^[[:space:]]*frontends:[[:space:]]*\[[[:space:]]*[A-Za-z0-9_-]+' "$status_file" 2>/dev/null \
      | head -1 | sed -E 's/.*\[[[:space:]]*([A-Za-z0-9_-]+).*/\1/')
  fi
  [ -z "$val" ] && val="$def"
  echo "$val"
}

# stack_lock_forbidden_list <package.json> <stack> <lock.json>
# Echoes the space-separated forbidden deps that ARE present (empty if none).
stack_lock_forbidden_list() {
  local pkg="$1" stack="$2" lock="$3"
  [ -f "$pkg" ] || return 0
  [ -f "$lock" ] || return 0
  jq -r --slurpfile lock "$lock" --arg s "$stack" '
    ( [ (.dependencies // {}), (.devDependencies // {}), (.peerDependencies // {}) ]
      | map(keys) | add ) as $deps
    | ($lock[0][$s].forbidden // [])
    | map(select(. as $f | $deps | index($f)))
    | join(" ")
  ' "$pkg" 2>/dev/null
}

# stack_lock_required_missing <package.json> <stack> <lock.json>
# Echoes the space-separated required deps that are MISSING (empty if all present).
stack_lock_required_missing() {
  local pkg="$1" stack="$2" lock="$3"
  [ -f "$pkg" ] || return 0
  [ -f "$lock" ] || return 0
  jq -r --slurpfile lock "$lock" --arg s "$stack" '
    ( [ (.dependencies // {}), (.devDependencies // {}), (.peerDependencies // {}) ]
      | map(keys) | add ) as $deps
    | ($lock[0][$s].required // [])
    | map(select(. as $r | ($deps | index($r)) | not))
    | join(" ")
  ' "$pkg" 2>/dev/null
}

# stack_lock_emit_checks <package.json> <stack> <lock.json>
# Appends two checks (forbidden-absent, required-present) to CHECKS_JSON.
# Must be called from the gate's main shell so it can mutate CHECKS_JSON.
stack_lock_emit_checks() {
  local pkg="$1" stack="$2" lock="$3"

  if [ ! -f "$pkg" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"stack-lock-no-forbidden-deps","pass":true,"detail":"no package.json — skipped","duration_ms":0},
            {"name":"stack-lock-required-deps","pass":true,"detail":"no package.json — skipped","duration_ms":0}]')
    return 0
  fi

  local viol missing fb_pass fb_detail rq_pass rq_detail
  viol=$(stack_lock_forbidden_list "$pkg" "$stack" "$lock")
  missing=$(stack_lock_required_missing "$pkg" "$stack" "$lock")

  if [ -n "$viol" ]; then
    fb_pass=false; fb_detail="forbidden dependency present for stack '$stack':$viol — contradicts the declared stack"
  else
    fb_pass=true;  fb_detail="no forbidden deps for stack '$stack'"
  fi
  if [ -n "$missing" ]; then
    rq_pass=false; rq_detail="required dependency missing for stack '$stack':$missing"
  else
    rq_pass=true;  rq_detail="required deps present for stack '$stack'"
  fi

  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    --argjson fbp "$fb_pass" --arg fbd "$fb_detail" \
    --argjson rqp "$rq_pass" --arg rqd "$rq_detail" \
    '. + [{"name":"stack-lock-no-forbidden-deps","pass":$fbp,"detail":$fbd,"duration_ms":0},
          {"name":"stack-lock-required-deps","pass":$rqp,"detail":$rqd,"duration_ms":0}]')
}

# --- PRD-stage prose check ------------------------------------------------------
# The PRD/knowledge doc is natural language, not package.json. A correct doc may
# legitimately say "TanStack Query ... prohibited", so a naive grep false-fails.
# We therefore flag a forbidden term ONLY on lines that lack a negation/prohibition
# marker — i.e. AFFIRMATIVE mentions. Prose terms live in stack-lock.json
# (forbidden_prose); negation markers are language constructs and live here.
STACK_LOCK_NEGATION='prohibit|forbidden|not[[:space:]]+use|do[[:space:]]+not|don.?t|never[[:space:]]+use|avoid|instead[[:space:]]+of|no[[:space:]]+longer|excluded|deprecated|미사용|금지|불가|사용하지|대신'

# stack_lock_prd_offenders <prd_file> <lock.json> <stack1> [<stack2> ...]
# Echoes affirmative forbidden-term lines (empty = clean).
stack_lock_prd_offenders() {
  local file="$1" lock="$2"; shift 2
  [ -f "$file" ] || return 0
  [ -f "$lock" ] || return 0
  local terms="" s t
  for s in "$@"; do
    t=$(jq -r --arg s "$s" '(.[$s].forbidden_prose // []) | join("|")' "$lock" 2>/dev/null)
    [ -n "$t" ] && { [ -n "$terms" ] && terms="$terms|$t" || terms="$t"; }
  done
  [ -z "$terms" ] && return 0
  # lines mentioning a forbidden term (as a WHOLE word, so 'recoil' does not match
  # 'recoiling' / 'prisma' does not match 'prismatic') AND lacking any negation marker.
  # Portable ERE word boundary: non-alnum (or line edge) on each side.
  grep -inE "(^|[^[:alnum:]])(${terms})([^[:alnum:]]|$)" "$file" 2>/dev/null \
    | grep -ivE "$STACK_LOCK_NEGATION"
}

# stack_lock_emit_prd_check <prd_file> <lock.json> <stack1> [<stack2> ...]
# Appends one check (stack-lock-prd) to CHECKS_JSON.
stack_lock_emit_prd_check() {
  local file="$1" lock="$2"; shift 2
  if [ ! -f "$file" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"stack-lock-prd","pass":true,"detail":"no PRD knowledge doc — skipped","duration_ms":0}]')
    return 0
  fi
  local offenders first
  offenders=$(stack_lock_prd_offenders "$file" "$lock" "$@")
  if [ -n "$offenders" ]; then
    first=$(echo "$offenders" | head -2 | tr '\n' ' ' | cut -c1-180)
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "PRD affirmatively names a forbidden stack lib: $first" \
      '. + [{"name":"stack-lock-prd","pass":false,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"stack-lock-prd","pass":true,"detail":"no forbidden stack lib affirmatively mentioned in PRD","duration_ms":0}]')
  fi
}
