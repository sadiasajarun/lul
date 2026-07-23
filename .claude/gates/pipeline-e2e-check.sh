#!/bin/bash
# pipeline-e2e-check.sh — Structural E2E validation of the fullstack pipeline
# Verifies: blueprints → gates → runner → rules → fullstack.md wiring
#
# Usage: bash gates/pipeline-e2e-check.sh [--target /path/to/project]
#
# Without --target: validates pipeline structure only (no project needed)
# With --target: also runs all gate scripts against the target project

set -o pipefail

CLAUDE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR=""
ERRORS=0
WARNINGS=0
PASSES=0

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --target) TARGET_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; PASSES=$((PASSES + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARNINGS=$((WARNINGS + 1)); }
section() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

# ============================================================
section "1. Blueprint → Gate Wiring"
# Every blueprint YAML must have an id: gate deterministic node
# ============================================================

BLUEPRINT_DIR="$CLAUDE_DIR/blueprints"
GATE_DIR="$CLAUDE_DIR/gates"

for bp in "$BLUEPRINT_DIR"/*.yaml; do
  bp_name=$(basename "$bp" .yaml)

  # Check gate node exists in blueprint
  if grep -q 'id: gate' "$bp" 2>/dev/null; then
    pass "Blueprint $bp_name has gate node"
  else
    fail "Blueprint $bp_name MISSING gate node — gate will never execute"
  fi

  # Check gate node is type: deterministic
  if grep -A2 'id: gate' "$bp" | grep -q 'type: deterministic'; then
    pass "Blueprint $bp_name gate is deterministic (not skippable)"
  else
    fail "Blueprint $bp_name gate is NOT deterministic — AI can skip it"
  fi

  # Check gate command references existing gate script
  gate_cmd=$(grep -A5 'id: gate' "$bp" | grep 'command:' | head -1)
  gate_script=$(echo "$gate_cmd" | grep -oE '[a-z-]+-gate\.sh')
  if [ -n "$gate_script" ] && [ -f "$GATE_DIR/$gate_script" ]; then
    pass "Blueprint $bp_name → $gate_script exists"
  elif [ -n "$gate_script" ]; then
    fail "Blueprint $bp_name references $gate_script but file NOT FOUND"
  else
    fail "Blueprint $bp_name gate node has no command"
  fi
done

# ============================================================
section "2. Gate Scripts → Runner Wiring"
# Every gate script must source _gate-runner.sh
# ============================================================

for gate in "$GATE_DIR"/*-gate.sh; do
  gate_name=$(basename "$gate")
  [ "$gate_name" = "pipeline-e2e-check.sh" ] && continue

  if grep -q '_gate-runner.sh' "$gate" 2>/dev/null; then
    pass "$gate_name sources _gate-runner.sh"
  else
    fail "$gate_name does NOT source _gate-runner.sh — output won't be structured JSON"
  fi

  if grep -q 'init_gate' "$gate" 2>/dev/null; then
    pass "$gate_name calls init_gate()"
  else
    fail "$gate_name does NOT call init_gate()"
  fi

  if grep -q 'output_results' "$gate" 2>/dev/null; then
    pass "$gate_name calls output_results()"
  else
    fail "$gate_name does NOT call output_results()"
  fi

  # Check at least 1 run_check or run_count_check or file_exists_check
  check_count=$(grep -cE '(run_check|run_count_check|file_exists_check)' "$gate" 2>/dev/null || echo 0)
  if [ "$check_count" -gt 0 ]; then
    pass "$gate_name has $check_count checks"
  else
    fail "$gate_name has ZERO checks — gate is empty"
  fi
done

# ============================================================
section "3. Gate Runner Integrity"
# _gate-runner.sh must have all required functions
# ============================================================

RUNNER="$GATE_DIR/_gate-runner.sh"

for func in init_gate run_check run_count_check file_exists_check output_results; do
  if grep -q "^${func}()" "$RUNNER" 2>/dev/null; then
    pass "_gate-runner.sh has $func()"
  else
    fail "_gate-runner.sh MISSING $func()"
  fi
done

# Check output_results produces valid JSON structure (jq -n uses unquoted keys)
if grep -q 'gate:' "$RUNNER" && grep -q 'checks:' "$RUNNER" && grep -q 'score:' "$RUNNER"; then
  pass "_gate-runner.sh output has gate/checks/score fields"
else
  fail "_gate-runner.sh output missing required JSON fields"
fi

# ============================================================
section "4. fullstack.md Orchestrator Integrity"
# Step 4.4 must have MANDATORY gate language
# ============================================================

FULLSTACK="$CLAUDE_DIR/commands/fullstack.md"

if grep -q 'MANDATORY' "$FULLSTACK" 2>/dev/null; then
  pass "fullstack.md Step 4.4 has MANDATORY keyword"
else
  fail "fullstack.md Step 4.4 missing MANDATORY — AI may skip gates"
fi

if grep -q 'CRITICAL.*NOT optional' "$FULLSTACK" 2>/dev/null; then
  pass "fullstack.md has CRITICAL warning about gate execution"
else
  fail "fullstack.md missing CRITICAL warning"
fi

if grep -q 'never self-assigned\|never self.assigned\|Score MUST come from gate' "$FULLSTACK" 2>/dev/null; then
  pass "fullstack.md enforces gate-derived scores (not self-assigned)"
else
  fail "fullstack.md doesn't enforce gate-derived scores — AI may self-assign"
fi

if grep -q 'MUST Run:.*gates/' "$FULLSTACK" 2>/dev/null; then
  pass "fullstack.md uses 'MUST Run:' for gate execution"
else
  fail "fullstack.md uses soft 'Run:' instead of 'MUST Run:' — AI may treat as optional"
fi

# Check Gate Failure Protocol exists
if grep -q 'Gate Failure Protocol' "$FULLSTACK" 2>/dev/null; then
  pass "fullstack.md has Gate Failure Protocol (4.3c)"
else
  fail "fullstack.md missing Gate Failure Protocol"
fi

# Check max 2 fix rounds
if grep -q 'max 2' "$FULLSTACK" 2>/dev/null; then
  pass "fullstack.md has max 2 fix rounds limit"
else
  warn "fullstack.md missing explicit max retry limit"
fi

# ============================================================
section "5. Phase Coverage — Blueprint vs Gate vs Rules"
# Cross-check: every phase with buildable artifacts has a blueprint AND gate
# ============================================================

# Phases that MUST have blueprints + gates (they produce code artifacts)
REQUIRED_PHASES="database backend frontend integrate test-api test-browser"

for phase in $REQUIRED_PHASES; do
  # Blueprint check
  if [ -f "$BLUEPRINT_DIR/$phase.yaml" ]; then
    pass "Phase $phase has blueprint"
  else
    fail "Phase $phase MISSING blueprint — execution is unstructured"
  fi

  # Gate script check
  if [ -f "$GATE_DIR/$phase-gate.sh" ]; then
    pass "Phase $phase has gate script"
  else
    fail "Phase $phase MISSING gate script — no quality enforcement"
  fi

  # Rules file check
  if [ -f "$CLAUDE_DIR/rules/phases/$phase.rules.md" ]; then
    pass "Phase $phase has rules file"
  else
    warn "Phase $phase missing rules file"
  fi
done

# Extra gates that exist without blueprints (acceptable — used at Step 4.4 fallback)
for gate in "$GATE_DIR"/*-gate.sh; do
  gate_name=$(basename "$gate" -gate.sh)
  if ! echo "$REQUIRED_PHASES" | grep -qw "$gate_name"; then
    if [ -f "$BLUEPRINT_DIR/$gate_name.yaml" ]; then
      pass "Extra gate $gate_name has matching blueprint"
    else
      warn "Gate $gate_name exists but has no blueprint (executed via Step 4.4 fallback)"
    fi
  fi
done

# ============================================================
section "6. Rules → Gate Cross-Reference"
# Rules marked with ✅ gate: must have corresponding check in gate script
# ============================================================

for rules_file in "$CLAUDE_DIR"/rules/phases/*.rules.md; do
  phase_name=$(basename "$rules_file" .rules.md)
  gate_file="$GATE_DIR/$phase_name-gate.sh"

  if [ ! -f "$gate_file" ]; then
    continue
  fi

  # Extract gate check names referenced in rules
  gate_refs=$(grep -oE 'gate:.*`[^`]+`' "$rules_file" 2>/dev/null | grep -oE '`[^`]+`' | tr -d '`')
  if [ -z "$gate_refs" ]; then
    continue
  fi

  for ref in $gate_refs; do
    # Check if this check name appears in the gate script
    if grep -q "$ref" "$gate_file" 2>/dev/null; then
      pass "Rule ✅ $ref → found in $phase_name-gate.sh"
    else
      fail "Rule ✅ $ref referenced in $phase_name.rules.md but NOT in gate script"
    fi
  done
done

# ============================================================
section "7. Blueprint Node Ordering"
# Gate node must be the LAST node in each blueprint
# ============================================================

for bp in "$BLUEPRINT_DIR"/*.yaml; do
  bp_name=$(basename "$bp" .yaml)

  # Get last node id
  last_node=$(grep 'id:' "$bp" | tail -1 | sed 's/.*id: *//' | tr -d ' ')

  if [ "$last_node" = "gate" ]; then
    pass "Blueprint $bp_name: gate is last node"
  else
    fail "Blueprint $bp_name: gate is NOT last node (last=$last_node) — checks may run before code is complete"
  fi
done

# ============================================================
section "8. criteria.yaml Sync"
# Gate conditions in criteria.yaml must reference real gate check names
# ============================================================

CRITERIA="$CLAUDE_DIR/pipeline/evaluation/criteria.yaml"

if [ -f "$CRITERIA" ]; then
  # Extract gate_condition entries
  gate_conditions=$(grep 'gate_condition:' "$CRITERIA" 2>/dev/null | sed 's/.*gate_condition: *//')

  if [ -n "$gate_conditions" ]; then
    pass "criteria.yaml has gate_condition entries"
  else
    warn "criteria.yaml has no gate_condition entries"
  fi
else
  fail "criteria.yaml not found"
fi

# ============================================================
section "9. Anti-Skip Enforcement (Layer 1/7 checks)"
# Verify _gate-runner.sh has proof generation and gate scripts
# have the required Layer 7 checks
# ============================================================

# Check _gate-runner.sh has proof functions
if grep -q 'write_gate_proof' "$RUNNER" 2>/dev/null; then
  pass "_gate-runner.sh has write_gate_proof() (Layer 1)"
else
  fail "_gate-runner.sh MISSING write_gate_proof() — proofs won't be generated"
fi

if grep -q 'record_gate_to_status' "$RUNNER" 2>/dev/null; then
  pass "_gate-runner.sh has record_gate_to_status() (Layer 1)"
else
  fail "_gate-runner.sh MISSING record_gate_to_status()"
fi

# Check design-gate.sh has client-approval check (Layer 7)
DESIGN_GATE="$GATE_DIR/design-gate.sh"
if [ -f "$DESIGN_GATE" ]; then
  if grep -q 'client-approval\|approved: true' "$DESIGN_GATE" 2>/dev/null; then
    pass "design-gate.sh has client-approval check (Layer 7)"
  else
    fail "design-gate.sh MISSING client-approval check — design can pass without client confirmation"
  fi
fi

# Check user-stories-gate.sh has prerequisite check (Layer 7)
US_GATE="$GATE_DIR/user-stories-gate.sh"
if [ -f "$US_GATE" ]; then
  if grep -q 'prereq-design-approved\|prerequisite.*design' "$US_GATE" 2>/dev/null; then
    pass "user-stories-gate.sh has prereq-design-approved check (Layer 7)"
  else
    fail "user-stories-gate.sh MISSING prerequisite check — user-stories can run before design approval"
  fi
fi

# Check fullstack.md has prerequisite enforcement (Layer 7)
if grep -q '4\.0b\|Verify Prerequisites' "$FULLSTACK" 2>/dev/null; then
  pass "fullstack.md has Step 4.0b prerequisite enforcement (Layer 7)"
else
  fail "fullstack.md MISSING Step 4.0b — phases can run without prerequisites"
fi

# Check fullstack.md has proof verification in Step 4.4
if grep -q 'VERIFY PROOF\|gate-proofs' "$FULLSTACK" 2>/dev/null; then
  pass "fullstack.md Step 4.4 has proof verification (Layer 1)"
else
  fail "fullstack.md Step 4.4 MISSING proof verification"
fi

# Check blueprints have evidence-check nodes (Layer 3)
for bp in "$BLUEPRINT_DIR"/*.yaml; do
  bp_name=$(basename "$bp" .yaml)
  if grep -q 'id: evidence-check' "$bp" 2>/dev/null; then
    pass "Blueprint $bp_name has evidence-check node (Layer 3)"
  else
    warn "Blueprint $bp_name missing evidence-check node"
  fi
done

# ============================================================
# PART B: Target Project Validation (only with --target)
# ============================================================

if [ -n "$TARGET_DIR" ]; then
  section "10. Gate Execution Against Target: $TARGET_DIR"

  if [ ! -d "$TARGET_DIR" ]; then
    fail "Target directory not found: $TARGET_DIR"
  else
    pass "Target directory exists: $TARGET_DIR"

    for gate in "$GATE_DIR"/*-gate.sh; do
      gate_name=$(basename "$gate" .sh)
      [ "$gate_name" = "pipeline-e2e-check" ] && continue

      echo -e "\n  ${CYAN}Running $gate_name...${NC}"
      output=$(bash "$gate" "$TARGET_DIR" 2>&1) || true

      # Check if output is valid JSON
      if echo "$output" | jq . >/dev/null 2>&1; then
        score=$(echo "$output" | jq -r '.score // "null"')
        passed=$(echo "$output" | jq -r '.passed // "null"')
        total_checks=$(echo "$output" | jq '.checks | length')
        passed_checks=$(echo "$output" | jq '[.checks[] | select(.pass==true)] | length')
        failed_names=$(echo "$output" | jq -r '[.checks[] | select(.pass==false) | .name] | join(", ")')

        if [ "$passed" = "true" ]; then
          pass "$gate_name: PASSED ($passed_checks/$total_checks checks, score=$score)"
        else
          warn "$gate_name: FAILED ($passed_checks/$total_checks checks, score=$score)"
          [ -n "$failed_names" ] && echo -e "    ${RED}Failed: $failed_names${NC}"
        fi
      else
        fail "$gate_name: output is NOT valid JSON"
        echo "    Output (first 200 chars): $(echo "$output" | head -c 200)"
      fi
    done

    # ==========================================================
    section "11. Anti-Skip Audit (Layer 4)"
    # For every Complete phase with a gate: verify proof + log
    # ==========================================================

    STATUS_FILE=$(find "$TARGET_DIR/.claude-project/status" -name 'PIPELINE_STATUS.md' 2>/dev/null | head -1)

    if [ -n "$STATUS_FILE" ]; then
      GATED_PHASES="database backend frontend integrate test-api test-browser ship design user-stories"

      for phase in $GATED_PHASES; do
        # Check if phase is Complete in status file
        STATUS_LINE=$(grep "| $phase " "$STATUS_FILE" 2>/dev/null | head -1)
        echo "$STATUS_LINE" | grep -q "Complete" || continue

        # 1. Proof file must exist
        PROOF_FILE="$TARGET_DIR/.claude-project/$PROJECT_NAME/status/.gate-proofs/${phase}.proof"
        if [ -f "$PROOF_FILE" ]; then
          PROOF_SCORE=$(grep '^score:' "$PROOF_FILE" | awk '{print $2}')
          pass "Anti-skip: $phase has proof (score=$PROOF_SCORE)"
        else
          fail "Anti-skip: $phase is Complete but .gate-proofs/${phase}.proof MISSING — gate was never run"
        fi

        # 2. Execution Log entry must exist
        EXEC_LOG_HAS=$(awk '/## Execution Log/,/^## /' "$STATUS_FILE" | grep "| $phase |" | wc -l | tr -d ' ')
        if [ "$EXEC_LOG_HAS" -gt 0 ]; then
          pass "Anti-skip: $phase has Execution Log entry"
        else
          fail "Anti-skip: $phase Complete but no Execution Log entry"
        fi
      done
    else
      warn "Anti-skip: PIPELINE_STATUS.md not found — skipping audit"
    fi
  fi
fi

# ============================================================
section "SUMMARY"
# ============================================================

TOTAL=$((PASSES + ERRORS + WARNINGS))
echo ""
echo -e "  ${GREEN}Passed: $PASSES${NC}"
echo -e "  ${RED}Failed: $ERRORS${NC}"
echo -e "  ${YELLOW}Warnings: $WARNINGS${NC}"
echo -e "  Total: $TOTAL checks"
echo ""

if [ "$ERRORS" -eq 0 ]; then
  echo -e "  ${GREEN}━━━ PIPELINE E2E: ALL CLEAR ━━━${NC}"
  exit 0
else
  echo -e "  ${RED}━━━ PIPELINE E2E: $ERRORS FAILURES ━━━${NC}"
  exit 1
fi
