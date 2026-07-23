# Fullstack v1 (Legacy)

LLM-interpreted orchestrator. The LLM reads `fullstack.md` (1000+ lines) and decides what to do.

## Usage

```bash
claude --dangerously-skip-permissions -p "/fullstack --phase backend"
```

## Characteristics

- Orchestrator = the LLM itself
- Agentic nodes run inside the SAME context window
- Artifact verification = self-reported (can lie/skip)
- Tool scoping = advisory only
- Blueprints: `*.yaml`

## Status

⚠️ **Legacy** — Use v2 for new projects. v1 is useful for quick experiments but lacks the trust guarantees of v2.

## Files

- `fullstack.md` — Main command (the "orchestrator" prompt)
- `blueprint-runner.js` — Blueprint execution helper
- `claude-agent-runner.js` — Agent subprocess runner
- `run-phase.sh` — Phase execution script
- Other scripts — Supporting utilities
