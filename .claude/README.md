# claude-fullstack

AI-powered full-stack application pipeline. Two orchestrator versions with shared assets.

## Structure

```
claude-fullstack/
├── v1/                 # Legacy LLM-interpreted orchestrator
├── v2/                 # Production code-based orchestrator ← RECOMMENDED
├── blueprints/         # Shared phase blueprints (*.yaml = v1, *-2.yaml = v2)
├── gates/              # Shared quality gates
├── templates/          # Shared templates
├── commands/           # Other Claude Code slash commands
├── agents/             # Agent definitions
├── nestjs/             # NestJS-specific rules
├── react/              # React-specific rules
└── ...
```

## Quick Start

### v2 (Recommended)

```bash
# Dry run
node .claude/v2/orchestrator.js myproject --phase init --dry-run

# Real run with Claude Code
node .claude/v2/orchestrator.js myproject --run-all

# Real run with OpenCode (multi-model support)
AGENT_BACKEND=opencode node .claude/v2/orchestrator.js myproject --run-all
```

### v1 (Legacy)

```bash
claude --dangerously-skip-permissions -p "/fullstack --phase backend"
```

## v1 vs v2

| Aspect | v1 | v2 |
|--------|----|----|
| Orchestrator | LLM interprets 1000-line prompt | Node.js walks YAML deterministically |
| Trust | LLM can skip/lie about work | Hard verification (fs.existsSync) |
| Agentic nodes | Same context window | Isolated subprocess per node |
| Tool scoping | Advisory | Strict --disallowed-tools |
| Episode logging | None | JSONL for RL training (preserved across `--refresh`) |
| Fanout | None | Per-module / per-page parallel cells with artifact-mtime cache |
| Multi-backend | No | Yes (Claude Code + OpenCode) |
| Model selection | N/A | Per-node via blueprint |
| Learning bridge | YAML (mostly empty) | `distill-learnings.js` — episodes → `memory/LEARNINGS.md` |

**Use v2 for production. Use v1 for quick experiments.**

## Memory & learning across runs

Two complementary persistent stores survive `--refresh`:

1. **`<project>/.claude-project/memory/*.md`** — `DECISIONS.md`, `LEARNINGS.md`, `PREFERENCES.md`. Templated, LLM/human-curated. Read by agents at run start.
2. **`<project>/.claude-project/episodes/ep-*.jsonl`** — append-only event streams. Raw RL training data. One file per `/fullstack-2` invocation.

The bridge between them is [v2/distill-learnings.js](v2/distill-learnings.js) — it harvests each episode (phases, fanout cells, gate scores, eval drift, costs) into a structured "Run history" section of `LEARNINGS.md`. Run after every pipeline run (or on a hook). Idempotent. See [v2/README.md#memory--learning-bridge](v2/README.md) for details.

## Pipeline Phases

```
init → spec → prd → (design ∥ database) → (user-stories ∥ backend) → frontend → integrate → test-api → test-browser → ship
```

## v1 Commands: `/fullstack`, `/fullstack-pm`, `/fullstack-dev`

The v1 orchestrator provides three slash commands. Pick one per project — **do not mix** them on the same project.

| Command | When to use | Scope |
|---|---|---|
| `/fullstack` | Run the entire pipeline with one command (legacy, unchanged) | All phases 0–10 |
| `/fullstack-pm` | PM team: drive spec → PRD → design prototypes, hand off to Dev | P1-spec, P2-prd, P3-design (new) |
| `/fullstack-dev` | Dev team: pick up PRD + approved HTML, build to ship | D1-init, D2-tech-spec, D3–D10 |

### PM → Dev Handoff Artifacts

`/fullstack-pm` produces exactly what `/fullstack-dev` needs:

1. `.claude-project/docs/PRD.md` — canonical PRD
2. `.claude-project/design/html/<role>/*.html` — approved HTML, organized by user role (e.g. `admin/`, `user/`)
3. `DESIGN_STATUS.md` with `approved: true`, `phase_complete: true`, and a PRD snapshot (hash, version, bundle hash)

### /fullstack-dev Entry Tiers

Before running any Dev phase, `/fullstack-dev` validates:

- **Tier 1** (required): PRD + HTML + approval signal (or `--trust-design` for external designer HTML)
- **Tier 2** (consistency): current PRD SHA256 matches `DESIGN_STATUS.prd_hash_at_generation`
  - Mismatch → hard-fail with guidance to run `/fullstack-pm --update --prd <path>`
  - Missing snapshot → warn unless `--accept-design-drift`
- **Tier 3** (role structure): `design/html/<role>/*.html` folders present (flat structure → warn; `--strict-roles` escalates to hard-fail)

### What /fullstack-dev Adds Beyond Legacy

- `.claude-project/design/design-intent.yaml` — machine-readable interpretation of HTML (endpoints, forms, realtime hints inferred by D1). Engineers may edit before D2 re-runs.
- `PROJECT_KNOWLEDGE.md`, `PROJECT_API.md`, `PROJECT_DATABASE.md` now include frontmatter with `prd_hash` + `intent_hash` — stale docs are detected automatically.
- `PROJECT_API.md` adds cross-reference sections: Screen → Endpoints, Endpoint → Screens, Role × Endpoint authz matrix.
- PM design HTML is organized by role folder rather than flat.

### Example Flows

```bash
# Greenfield PM → Dev
/fullstack-pm my-saas --run-all --skip-spec --prd input.md
# PAUSE at P3d — client picks variation, edits DESIGN_STATUS.md
/fullstack-pm my-saas --phase P3-design --resume
/fullstack-dev my-saas --run-all

# External PRD + external HTML (no PM run)
/fullstack-dev my-ext --trust-design --accept-design-drift --run-all

# PRD changed — update cycle
/fullstack-pm my-saas --update --prd docs/PRD_v2.md
/fullstack-dev my-saas   # D1 re-extracts intent, D2 regenerates docs, cascade to D4+

# Legacy full pipeline (unchanged)
/fullstack legacy-proj --run-all --skip-spec --prd input.md
```

### Do Not Mix Orchestrators on One Project

- Legacy `/fullstack` writes flat HTML and no PRD snapshot in `DESIGN_STATUS.md`.
- Neo `/fullstack-pm`+`/fullstack-dev` write role-folder HTML and extended snapshot.
- Mixing creates conflicting state. Pick one orchestration per project.
- `/fullstack-dev` will warn if it detects legacy artifacts on entry.

## Running on OpenCode

The v2 orchestrator supports OpenCode as an alternative subprocess backend.
One-shot setup per project (run from project root, where `.claude/` is a
submodule):

```bash
bash .claude/scripts/setup-opencode.sh
```

This installs:

- `.opencode/commands/fullstack-2.md` — slash command discoverable by OpenCode
- `opencode.json` — minimal config with non-interactive permission grants
- `AGENTS.md` → `CLAUDE.md` symlink (OpenCode's instruction-file convention)

It also runs `git submodule update --init --recursive` so `.claude/nestjs`,
`.claude/react`, and `.claude/operations` are populated.

After setup:

```bash
opencode                              # launches TUI
/fullstack-2 <project> --dry-run      # smoke test, no API spend
/fullstack-2 <project> --run-all      # real run
```

Or run headless without the TUI:

```bash
AGENT_BACKEND=opencode \
OPENCODE_DEFAULT_MODEL=anthropic/claude-sonnet-4-5 \
node .claude/v2/orchestrator.js <project> --run-all
```

The orchestrator dispatches each agentic node via [v2/lib/agent-opencode.js](v2/lib/agent-opencode.js)
(`opencode run --format json --model ...`) instead of `claude --print`.
Source-of-truth files under `.claude/` (including `react/`, `nestjs/`,
`operations/` submodule contents) are read by the orchestrator's parent Node
process and inlined into each subprocess prompt — no platform-specific glue
is required for submodule access.

### Multi-model parallel runs

`AGENT_BACKEND=opencode` plus `OPENCODE_DEFAULT_MODEL=...` lets you run the
same project with different models concurrently using `--path` to isolate
target dirs. Episodes accumulate per-variant under
`<target>/.claude-project/episodes/`. Combined with the cross-variant
distillation bridge, this is the foundation for "iteration N is measurably
better than N-1" experiments — see plan files under `.claude/plans/` for
harness layout.

### Known limitations vs Claude Code

- Tool scoping (`tool_profile.allow/deny` in blueprints) is not enforced;
  permissions come from project `opencode.json` instead. Same risk profile as
  Claude Code's `--dangerously-skip-permissions`.
- Hooks (`auto-test.sh`, `auto-commit.sh`, `protect-sensitive.sh`, etc.) are
  Claude Code-only and do not fire under OpenCode.
- The `SessionStart` pipeline-state banner does not appear; check
  `.claude-project/status/<project>/PIPELINE_STATUS.md` directly.

### OpenCode 1.1.x compatibility

[v2/lib/agent-opencode.js](v2/lib/agent-opencode.js) was adjusted for OpenCode
1.1.x CLI surface: dropped `--dangerously-skip-permissions` (use the
`permission` block in `opencode.json` instead) and `--dir` (cwd is set on
subprocess spawn, not via flag). Older OpenCode versions are not supported.

## Documentation

- [v1 README](v1/README.md)
- [v2 README](v2/README.md)
- [Pipeline Architecture](PIPELINE_ARCHITECTURE.md)
