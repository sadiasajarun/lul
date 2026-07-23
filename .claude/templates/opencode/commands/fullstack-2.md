---
description: Code-based fullstack orchestrator v2 — subprocess-enforced agent execution with artifact contracts (OpenCode)
agent: build
---

# Fullstack Orchestrator v2 (code-based, OpenCode)

Mirror of the Claude Code `/fullstack-2` command, adapted for OpenCode. The
orchestrator is identical — only the subprocess backend differs. Spawned
agentic nodes run via `opencode run` instead of `claude --print` because the
launch line below sets `AGENT_BACKEND=opencode`.

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
| `--prd <path>` | Load a PRD file (md/pdf), clear old chunks, reset prd phase |
| `--refresh` | Wipe generated artifacts. Prints plan by default — pass `--yes` to delete |
| `--yes` | Confirmation flag for destructive operations |
| `--path <dir>` | Target a different project directory than cwd |

## Tuning flags

| Flag | Default | Applies to |
|---|---|---|
| `--quality <float>` | `0.95` | All loop modes |
| `--max-iterations <int>` | `5` | `--phase X --loop` |
| `--max-generations <int>` | `10` | `--loop` |
| `--verbose` | off | Print extra deterministic node output |
| `--no-events` | events on | Disable episode event logging |

Phase order for `--run-all` / `--loop`:
`init → spec → prd → design → database → user-stories → backend → frontend → integrate → test-api → test-browser → ship`

## Prerequisites

- `opencode.json` at project root must grant non-interactive permissions
  (the `setup-opencode.sh` installer writes a permissive default).
- An OpenCode model must be configured — either globally
  (`~/.config/opencode/opencode.json`) or via `OPENCODE_DEFAULT_MODEL` env.
- Submodules must be initialized: `git submodule update --init --recursive`.

## Known limitations vs Claude Code

- **Tool scoping not enforced.** Blueprints declare `tool_profile.allow/deny`
  per node; the OpenCode runner currently relies on `opencode.json` `permission`
  block instead of per-call tool restriction. Same risk profile as
  `--dangerously-skip-permissions`.
- **Hooks not ported.** Claude Code's `auto-test.sh` / `auto-commit.sh` /
  `protect-sensitive.sh` do not fire under OpenCode in this minimal setup.
- **No SessionStart pipeline-state banner.** The `session-start-pipeline-state.sh`
  hook is Claude Code-only; check `.claude-project/status/<project>/PIPELINE_STATUS.md` directly.

---

## Execution

This command is a thin wrapper around the same Node.js orchestrator the Claude
Code variant launches. **Do not add execution logic here. Do not interpret the
user's request — just pass it through.**

Step 1: Run the orchestrator in the background, redirecting all output to a
timestamped logfile so it can be tailed live (never use `| tail` or any pipe
with a line-count filter — those buffer until EOF and hide progress):

```bash
LOG=".claude-project/agent-logs/fs2-$(date -u +%Y%m%dT%H%M%SZ).log"
mkdir -p .claude-project/agent-logs
AGENT_BACKEND=opencode node .claude/v2/orchestrator.js $ARGUMENTS > "$LOG" 2>&1 &
echo "pid=$! log=$LOG"
```

Tell the user the logfile path and how to tail it:
```
tail -f <LOG>
```

The orchestrator backgrounds itself via `&`, so the Bash call returns
immediately. Poll progress by reading the tail of `$LOG`, or by listing
`.claude-project/agent-logs/*.log` to see which agentic node is currently
active (newest file = current node).

Step 2: Once the orchestrator exits, report the final summary (last ~50 lines
of the logfile). Exit code 0 = success. Non-zero = report the failed phase +
node and point the user at the per-node log file the orchestrator printed. Do
not attempt to fix errors by running additional commands unless the user
explicitly asks.

Step 3: If the user asks what an agent actually did, point them at the logs in
`.claude-project/agent-logs/` (one file per agentic node per run, containing
the full prompt and the agent's stdout).

That's it. No additional logic. The script is in charge.
