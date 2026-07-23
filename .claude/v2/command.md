---
description: Code-based fullstack orchestrator v2 — subprocess-enforced agent execution with artifact contracts
argument-hint: "<project> [--phase <name> | --run-all | --loop] [--dry-run] [--resume] [--skip-spec]"
---

# Fullstack Orchestrator v2 (code-based)

A **parallel implementation** of `/fullstack`. Instead of the LLM reading a long
markdown file and deciding what to do, a Node.js orchestrator walks blueprint
YAMLs deterministically and spawns `claude --print` subprocesses for each
agentic node. Every agentic node has a mandatory artifact contract
(`required_output_file` + `verification_pattern` regex) that the orchestrator
verifies after the subprocess returns — there is no way for the agent to
silently skip work.

## Key differences from `/fullstack`

| Aspect | `/fullstack` (v1) | `/fullstack-2` (this command) |
|--------|-------------------|-------------------------------|
| Orchestrator | LLM interprets 1000-line MD | Node.js script walks YAML blueprints |
| Agentic nodes | LLM tools in the same context | `claude --print` subprocess per node |
| Artifact verification | Self-reported by LLM | `fs.existsSync` + regex match |
| Tool scoping | Advisory (`allowed-tools` hint) | Strict (`--disallowed-tools`) |
| Skip prevention | Trusts the LLM to read carefully | Impossible — code walks every node |
| Blueprint files | `*.yaml` | `*-2.yaml` (parallel copies) |
| Auth | Claude Code subscription | Same — no API key needed |

## Supported modes

| Flag combination | Behavior |
|---|---|
| `--phase <name>` | Run a single phase once |
| `--phase <name> --resume` | Continue a phase from its saved blueprint state |
| `--phase <name> --loop` | Re-run a single phase until score ≥ quality, max iterations, or stagnation |
| `--run-all` | Run every pending phase sequentially in pipeline order |
| `--loop` | Pipeline-wide generation loop — resets below-threshold phases each generation |
| `--loop --skip-spec` | Pipeline loop but skip the spec phase (when a PRD already exists) |
| `--dry-run` | Walk nodes without executing (all modes) |
| `--reset <phase>` | Reset a phase back to Pending and clear its blueprint state |
| `--prd <path>` | Load a PRD file (md/pdf), clear old chunks, reset prd phase. Chainable with --run-all or --phase |
| `--path <dir>` | Target a different project directory than cwd |

## Tuning flags

| Flag | Default | Applies to |
|---|---|---|
| `--quality <float>` | `0.95` | All loop modes — phase must reach this gate score to converge |
| `--max-iterations <int>` | `5` | `--phase X --loop` — hard cap per phase |
| `--max-generations <int>` | `10` | `--loop` — hard cap on pipeline generations |
| `--verbose` | off | Print extra output from deterministic nodes |
| `--no-events` | events on | Disable episode event logging for this run (training data is on by default; use this only for throwaway experiments) |
| `--keep-going` | off | When a fanout cell fails, finish surviving cells in the current batch before reporting phase failure (default: abort remaining batches at first failure) |

## Episode logging (always on)

Every real run writes an episode file to `.claude-project/episodes/ep-*.jsonl`.
These files are the training data for the reward function and future RL policy.
Dry-runs never emit events. Every real run also computes and prints an inline
reward summary at the end (R_episode breakdown by phase, generation, terminal).

`episodes/` is **excluded from `--refresh`** — it's append-only training data.
Wiping it would reset the bandit/policy learning signal to zero. Refresh clears
generated artifacts (code, docs, status); episode history is preserved like git
log. To purge episodes manually: `rm -rf .claude-project/episodes`.

Audit a run with:

```bash
node .claude/v2/reward-audit.js --latest
node .claude/v2/reward-audit.js --list 10
```

## Distilling episodes → LEARNINGS.md

Raw episode JSONL is machine-readable but agents need digested context. The
distiller reads episode events and appends a structured summary block per
episode to `.claude-project/memory/LEARNINGS.md` (under a "Run history"
section). Future agents see prior outcomes — phases passed/failed, fanout cell
counts, eval drift, costs — as part of their context.

```bash
node .claude/v2/distill-learnings.js              # all episodes (default)
node .claude/v2/distill-learnings.js --latest     # only most recent
node .claude/v2/distill-learnings.js --episode ep-2026-04-28T03  # one specific
node .claude/v2/distill-learnings.js --dry-run    # preview what would append
```

Idempotent — uses `<!-- ep:{id} -->` markers to skip episodes already
distilled. Safe to run after every pipeline run, on a hook, or manually.
Each entry has a `**what to remember**:` line where agents/humans can append
concise lessons that survive future re-runs of the distiller.

`memory/*.md` (DECISIONS, LEARNINGS, PREFERENCES) is preserved by `--refresh`
— so curated lessons + auto-distilled run history both accumulate across
refreshes.

## Node fanout

Any agentic node may declare a `fanout:` block to run as N parallel cells, one
per resolved subject (module, page, role, frontend). Each cell is a separate
subprocess with bounded context. Per-cell artifacts (`required_output_file`)
must include the `{subject_var}` token so each cell writes a distinct file.

```yaml
- id: implement
  type: agentic
  fanout:
    source: backend_modules     # which resolver to use
    subject_var: module         # template variable surfaced as {module}
    concurrency: 4              # max parallel cells (1..32, default 3)
  required_output_file: ".claude-project/status/{project}/BACKEND_IMPLEMENT_{module}.md"
  verification_pattern: "module:\\s*{module}"
```

Available `source:` values:

| Source | Subjects | Resolved from |
|---|---|---|
| `frontends` | frontend descriptors | `PIPELINE_STATUS.md` `frontends:` block |
| `backend_modules` | module name strings | `MODULE_INVENTORY.yaml` if present, else `### Module:` headings in PROJECT_KNOWLEDGE.md / PROJECT_API.md |
| `html_pages` | page slugs (basename of .html) | `.claude-project/design/html/*.html` |
| `roles` | role-name slugs | "User Types" section of PROJECT_KNOWLEDGE.md / PRD.md |

Aggregate reports are produced by a separate deterministic node placed after
the fanout node (see `merge-implement-reports`, `merge-convert-reports`). When
a cell fails, the orchestrator aborts remaining batches by default; pass
`--keep-going` to finish surviving cells in the current batch before failing
the phase.

If the resolver returns 0 subjects, the node fails with `fanout_no_subjects_<source>`.
Likely cause: an upstream phase that produces the source data has not run yet.

## Cross-reference consistency gate

`bash .claude/gates/cross-reference-consistency.sh <target> <project>` runs
six deterministic drift checks:

1. Routes in PROJECT_API.md ↔ controllers in `backend/src/modules/`
2. State enum values in PROJECT_DATABASE.md ↔ service references
3. HTML prototypes ↔ React page components
4. DB columns ↔ DTO/entity fields
5. i18n key parity across locale files
6. Frontend service URL literals ↔ backend route paths

Returns JSON with `score` and per-check pass/fail. Wired as advisory
deterministic nodes at the end of `backend`, `frontend`, and `integrate`
phases (output in `CONSISTENCY_REPORT_*.json`). When source-of-truth files are
missing the corresponding check is skipped (counts as pass) unless
`STRICT=true` is exported.

## Blueprints

All 12 pipeline phases have v2 blueprints in [.claude/blueprints/](.claude/blueprints/):
`init-2.yaml`, `spec-2.yaml`, `prd-2.yaml`, `design-2.yaml`, `database-2.yaml`,
`user-stories-2.yaml`, `backend-2.yaml`, `frontend-2.yaml`, `integrate-2.yaml`,
`test-api-2.yaml`, `test-browser-2.yaml`, `ship-2.yaml`. Every agentic node in
every blueprint declares `required_output_file` and `verification_pattern`.

Phase order for `--run-all` / `--loop`:
`init → spec → prd → design → database → user-stories → backend → frontend → integrate → test-api → test-browser → ship`

## Not yet ported from `/fullstack`

- Policy memory (RL bandit — needs 20+ scored episodes first)
- `--adopt` / `--update`
- Client confirmation pause for design variations — works via abort + `--resume` instead of inline AskUserQuestion

---

## Execution

This command is a thin wrapper around a Node.js script. The script IS the
orchestrator — this markdown file only launches it and reports output.

**Do not add execution logic here. Do not re-implement what the script does.
Do not interpret the user's request — just pass it through.**

Step 1: Run the orchestrator in the background, redirecting all output to a
timestamped logfile so it can be tailed live (never use `| tail` or any pipe
with a line-count filter — those buffer until EOF and hide progress):

```bash
LOG=".claude-project/agent-logs/fs2-$(date -u +%Y%m%dT%H%M%SZ).log"
mkdir -p .claude-project/agent-logs
node .claude/v2/orchestrator.js $ARGUMENTS > "$LOG" 2>&1 &
echo "pid=$! log=$LOG"
```

Tell the user the logfile path and how to tail it:
```
tail -f <LOG>
```

Use the Bash tool with `run_in_background: true` so the orchestrator keeps
running while you do other work. Poll progress by reading the tail of `$LOG`
with the Read tool, or by listing `.claude-project/agent-logs/*.log` to see
which agentic node is currently active (newest file = current node).

Step 2: Once the orchestrator exits, report the final summary (last ~50 lines
of the logfile). If the script exited with code 0, the run succeeded. If
non-zero, report the failed phase + node and point the user at the per-node
log file the orchestrator printed. Do not attempt to fix errors by running
additional commands unless the user explicitly asks.

Step 3: If the user asks what an agent actually did, point them at the logs in
`.claude-project/agent-logs/` (one file per agentic node per run, containing
the full prompt and the agent's stdout).

That's it. No additional logic. The script is in charge.
