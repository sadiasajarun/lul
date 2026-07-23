---
name: fullstack-command-improver
description: Use when seeking improvements to the /fullstack command or any complex command — spawns a 5-role team that runs infinite research-debate-propose cycles with stagnation detection
---

# Fullstack Command Improver

## Overview

An infinite-loop improvement engine. Spawns 5 specialized agents that continuously research, debate, and propose improvements to a target command. Each cycle builds on the last — research directions evolve, knowledge accumulates, and proposals get sharper.

**Core principle:** No single perspective catches everything. A team with competing viewpoints (architect vs devil's advocate, developer vs designer) produces higher-quality improvements than any solo analysis.

## When to Use

- Improving `/fullstack` or any complex orchestration command
- Auditing `.claude/` infrastructure for untapped capabilities
- Comparing your system with competing AI development frameworks
- Building a knowledge base of improvement opportunities over time
- When you want continuous, not one-shot, improvement discovery

**Don't use when:**
- Making a specific, known fix (just edit the file)
- Simple command additions (use writing-skills instead)
- The target command is < 100 lines (overkill)

---

## Team Roles

| Role | Agent Name | Model | Focus Area |
|------|-----------|-------|------------|
| **PM** (lead) | `pm` | opus | Orchestrates cycles, prioritizes by user impact, manages STATUS.md, identifies next research directions |
| **Claude Code Architect** | `architect` | opus | Reviews `.claude/` + `.claude/spec/` infrastructure, identifies reusable patterns, checks 3-tier compliance |
| **Fullstack Developer** | `developer` | sonnet | Tests command against real scenarios, web-researches competing frameworks, finds friction and gaps |
| **Designer** | `designer` | sonnet | DX ergonomics — CLI flags, status file clarity, error messages, onboarding, progressive disclosure |
| **Devil's Advocate** | `devil` | sonnet | Challenges every proposal: lists assumptions, considers opposites, asks "what if we did nothing?", finds edge cases |

---

## Execution Instructions

### Step 1: Setup

1. **Create team:**
   ```
   TeamCreate(team_name="improve-fullstack", description="Infinite improvement loop for /fullstack command")
   ```

2. **Initialize STATUS.md:**
   - Copy `.claude/skills/fullstack-command-improver/STATUS.template.md`
   - Save to `status/improve-fullstack/STATUS.md`
   - Replace `{TIMESTAMP}` with current datetime
   - Replace `{TARGET_FILE}` with the target command path (default: `.claude/commands/fullstack.md`)

3. **Read target command** and its history:
   - `.claude/commands/fullstack.md` (the target)
   - `.claude/docs/FULLSTACK_ORCHESTRATOR_HISTORY.md` (v1-v5 evolution, lessons learned)
   - `.claude/skills/fullstack/SKILL.md` (legacy v1 for comparison)

### Step 2: Spawn Agents

Spawn all 4 non-lead agents in parallel via Task tool:

```
Task(name="architect", team_name="improve-fullstack", model="opus", subagent_type="general-purpose")
Task(name="developer", team_name="improve-fullstack", model="sonnet", subagent_type="general-purpose")
Task(name="designer", team_name="improve-fullstack", model="sonnet", subagent_type="general-purpose")
Task(name="devil", team_name="improve-fullstack", model="sonnet", subagent_type="general-purpose")
```

PM (you, the lead) orchestrates from the main thread.

### Step 3: Seed Research Directions

Write initial research directions to STATUS.md `Active Research Directions` table:

**Architect (cycle 1):**
- What from `.claude/spec/` (ouroboros) isn't being used by fullstack but should be?
- Are all 10 phases using the best skill from the correct tier?
- Is the artifact invalidation system complete? Any missing dependency chains?
- Could team mode orchestration enhance parallel phase execution?
- Are there orphaned skills or commands that fullstack should reference?

**Developer (cycle 1):**
- Web research: How do Cursor Composer, Windsurf Cascade, Devin, OpenHands handle multi-step dev?
- What Ralph workflows are referenced but not implemented (database-qa, integration-qa)?
- Are quality gates realistic and measurable in practice?
- What happens for monorepos, microservices, mobile — does fullstack handle them?
- Is error recovery adequate when phases fail in real use?

**Designer (cycle 1):**
- Is PIPELINE_STATUS.md human-readable? Can a new user understand it at a glance?
- Are CLI flags intuitive (`--run` vs `--run-all` vs `--loop` vs `--phase`)?
- Is the onboarding flow clear for first-time users?
- Could the frontend multi-path selection (Figma/HTML/scratch) be simplified?
- Are error messages actionable? Do they tell users what to do next?

---

## Cycle Loop (Infinite)

> **PERSISTENCE RULE — DO NOT STOP**: Continue running cycles until the user sends `--stop` or stagnation cannot be broken. Never pause to ask if you should continue. Never stop because "enough improvements were found." Each cycle feeds the next.

### Phase 1: RESEARCH (parallel)

Send research assignments to all agents simultaneously:

```
SendMessage(type="message", recipient="architect", content="
CYCLE {N} RESEARCH — Claude Code Architect

Target: {TARGET_FILE} ({line_count} lines, {phase_count} phases)

Your research directions this cycle:
{directions_for_architect}

INSTRUCTIONS:
1. Read the target command file thoroughly
2. Explore .claude/ and .claude/spec/ folders for untapped capabilities
3. Read FULLSTACK_ORCHESTRATOR_HISTORY.md to understand past decisions
4. For each direction, provide:
   - What you found
   - Specific improvement opportunity (if any)
   - Which files would be affected
   - Estimated effort (S/M/L)

Send your findings back to me (pm) when done.
")
```

```
SendMessage(type="message", recipient="developer", content="
CYCLE {N} RESEARCH — Fullstack Developer

Target: {TARGET_FILE}

Your research directions this cycle:
{directions_for_developer}

INSTRUCTIONS:
1. Read the target command file thoroughly
2. Use WebSearch to research competing AI dev frameworks
3. Mentally test the command against real-world project scenarios
4. For each direction, provide:
   - What you found (with sources for web research)
   - Specific improvement opportunity (if any)
   - Real-world scenario where this matters
   - Estimated effort (S/M/L)

Send your findings back to me (pm) when done.
")
```

```
SendMessage(type="message", recipient="designer", content="
CYCLE {N} RESEARCH — Designer (DX Focus)

Target: {TARGET_FILE}

Your research directions this cycle:
{directions_for_designer}

INSTRUCTIONS:
1. Read the target command and all its user touchpoints (flags, status files, error messages, prompts)
2. Evaluate each touchpoint for clarity, discoverability, and learnability
3. For each direction, provide:
   - Current UX issue or friction point
   - Proposed improvement with before/after examples
   - Impact on user experience (high/medium/low)
   - Estimated effort (S/M/L)

Send your findings back to me (pm) when done.
")
```

Wait for all 3 agents to report back.

### Phase 2: PROPOSE

PM consolidates all research findings into numbered improvement proposals:

For each finding that suggests a concrete improvement:
```markdown
### Proposal {N}: {Title}

**Proposer:** {role}
**Priority:** P{0-3} (P0=critical, P1=high, P2=medium, P3=nice-to-have)
**Effort:** S/M/L
**Impact:** {description of user-facing benefit}

**Description:**
{What should change and why}

**Affected Files:**
- {file paths}

**Evidence:**
{Research findings, competitor analysis, or user scenario that supports this}
```

### Phase 3: DEBATE

Send all proposals to the Devil's Advocate:

```
SendMessage(type="message", recipient="devil", content="
CYCLE {N} DEBATE — Devil's Advocate

Review these {count} improvement proposals for {TARGET_FILE}.

{all_proposals_text}

For EACH proposal, you MUST:
1. List every assumption the proposal makes
2. Consider the opposite — what if this change makes things WORSE?
3. Ask: what happens if we do nothing? Is the current state actually fine?
4. Find the hardest edge case or scenario where this breaks
5. Estimate hidden costs (maintenance burden, complexity increase, 3-tier violations)
6. Give a verdict: APPROVE (with caveats) | REVISE (with specific suggestions) | REJECT (with reasoning)

Be respectful but relentless. If a proposal can't survive your scrutiny, it shouldn't be implemented.
")
```

Wait for Devil's response.

### Phase 4: CONSENSUS

PM reviews Devil's feedback and makes final decisions:

1. For APPROVED proposals: Add to STATUS.md with `Status: APPROVED`
2. For REVISE proposals: Update proposal based on Devil's feedback, mark `Status: REVISED`
3. For REJECTED proposals: Log to STATUS.md with `Status: REJECTED` and Devil's reasoning
4. Update `total_proposals` count
5. Update `Knowledge Base` sections with new learnings
6. Append to `Cycle Log` table

### Phase 5: DISCOVER NEXT DIRECTIONS

Based on this cycle's findings, identify new research directions:

1. What questions emerged from the research that weren't answered?
2. What areas were adjacent to findings but not explored?
3. What did the Devil's critique reveal that needs deeper investigation?
4. What competitor features were mentioned but not fully analyzed?

Write new directions to STATUS.md `Active Research Directions` table. Mark completed directions as `DONE`.

### Phase 6: CYCLE CHECK

```
1. Read STATUS.md
2. Count new findings this cycle (proposals added + knowledge base entries)

IF new_findings > 0:
   → Reset consecutive_empty_cycles to 0
   → Increment cycle counter
   → CONTINUE to next cycle with new research directions

IF new_findings == 0 AND consecutive_empty_cycles < 2:
   → Increment consecutive_empty_cycles
   → CONTINUE (give it another chance)

IF new_findings == 0 AND consecutive_empty_cycles >= 2:
   → STAGNATION DETECTED
   → Shift research angle:
     Cycle 1-3: Internal analysis (.claude/ infrastructure)
     Cycle 4-6: External benchmarking (competitor frameworks)
     Cycle 7-9: DX deep-dive (user journey mapping)
     Cycle 10+: Architecture rethink (fundamental assumptions)
   → Reset consecutive_empty_cycles
   → Increment research_angle_shifts
   → If research_angle_shifts >= 4: Report to user, suggest manual direction
   → CONTINUE with shifted angle

IF user sends --stop:
   → Write final summary to STATUS.md
   → SendMessage(type="shutdown_request") to all agents
   → TeamDelete
   → Report: total cycles, total proposals, top 3 by priority
```

---

## Stagnation Angle Shifts

When the same research directions produce no new findings, shift perspective:

| Shift # | New Angle | Research Focus |
|---------|-----------|---------------|
| 1 | **External Benchmarking** | Deep-dive competitor frameworks: Cursor, Windsurf, Devin, OpenHands, SWE-agent, Aider |
| 2 | **DX Deep-Dive** | Map complete user journey from first invocation to deployment, time every step |
| 3 | **Architecture Rethink** | Challenge fundamental assumptions: 10 phases? sequential? status files? Ralph dependency? |
| 4 | **User Report** | Present all findings, ask user for new directions or declare convergence |

---

## Status File Management

**Path:** `status/improve-fullstack/STATUS.md`
**Template:** `.claude/skills/fullstack-command-improver/STATUS.template.md`

### Update Rules

- PM updates STATUS.md at the end of EVERY cycle (Phase 4: Consensus)
- Knowledge Base sections are APPEND-ONLY (never delete learnings)
- Proposals can change status: NEW → APPROVED/REVISED/REJECTED
- Cycle Log is append-only
- Stagnation Tracker updates in Phase 6

### Knowledge Base Sections

The Knowledge Base accumulates institutional knowledge across all cycles:

- **What We Learned About .claude Infrastructure** — Skills, commands, agents, orchestration modes, templates, and their relationships
- **What We Learned About spec (Ouroboros)** — Spec-first system capabilities, integration opportunities, what's ready vs what needs work
- **Competitor Analysis** — Features, patterns, and approaches from other AI dev frameworks
- **DX Pain Points Identified** — Every friction point found, whether or not a proposal was made

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Stopping after one cycle | This is an INFINITE loop. Keep going until stagnation or --stop |
| Devil skips proposals | Devil MUST review EVERY proposal, no exceptions |
| Research without web search | Developer role MUST use WebSearch for competitor analysis |
| Overwriting STATUS.md knowledge | Knowledge Base is APPEND-ONLY, never delete previous findings |
| Ignoring FULLSTACK_ORCHESTRATOR_HISTORY.md | MUST read history first — proposals that repeat past failures get auto-rejected |
| All agents researching same thing | Each role has distinct research directions, enforce separation |
| Proposals without affected files | Every proposal MUST list specific files that would change |

---

## Adapting for Other Commands

This skill can improve ANY command by changing:

1. **Target file** in STATUS.md `target` field
2. **Research directions** in Step 3 (seed for the specific command's domain)
3. **Team roles** if the command's domain requires different expertise

Everything else — the cycle loop, debate phase, status tracking, stagnation detection — works unchanged.

---

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `writing-skills` | TDD approach for creating/editing skills — use for implementing approved proposals |
| `dispatching-parallel-agents` | Pattern for parallel research dispatch in Phase 1 |
| `brainstorming` | Can enhance the DISCOVER phase for creative direction generation |
| `requesting-code-review` | Use when implementing approved proposals to verify quality |
