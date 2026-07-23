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
| `--refresh` | Wipe generated artifacts (backend/, frontend/, docs, design variations, status/{project}, agent-logs, etc.). Preserves PRD, memory (DECISIONS/LEARNINGS/PREFERENCES), design system, seed.yaml, **and `episodes/` (RL training data, append-only)**. Prints plan by default — pass `--yes` to delete |
| `--yes` | Confirmation flag for destructive operations (currently only `--refresh`) |
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
Refresh wipes generated artifacts (code, docs, status); episode history
survives like git log so cross-run learning compounds.

Audit a run with:

```bash
node .claude/v2/reward-audit.js --latest
node .claude/v2/reward-audit.js --list 10
```

Distill episodes into LLM-readable notes in `memory/LEARNINGS.md`:

```bash
node .claude/v2/distill-learnings.js --latest    # newest run
node .claude/v2/distill-learnings.js             # all runs
```

## Node fanout

Agentic nodes can declare `fanout:` to run as N parallel cells (one per
module / page / role / frontend) with concurrency cap. Each cell sees a
`{subject_var}` substitution in its prompt + artifact path. The orchestrator
runs each cell as a separate subprocess with bounded context.

Cells whose artifact already exists, verifies, and is fresher than every
upstream input declared in `additional_read` are **skipped via cache**
(`PASS` with `cached: true`) — retries (post-quota, `--loop`, gate-failure
recovery) don't re-spend on cells that already passed. Set `FANOUT_NO_CACHE=1`
to force re-run. Use `--keep-going` to let the current batch finish surviving
cells before reporting phase failure.

See [v2/README.md](.claude/v2/README.md) for resolver list, cache rules, and blueprint examples.

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
