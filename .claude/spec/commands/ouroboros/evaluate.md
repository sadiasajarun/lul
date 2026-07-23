---
description: 3-stage verification pipeline — mechanical, semantic, consensus
---

# /ouroboros:evaluate

Evaluate implementation with a progressive 3-stage verification pipeline.

## Usage

```
/ouroboros:evaluate [seed_file_or_artifact]
```

**Trigger keywords:** "evaluate this", "3-stage check", "ooo evaluate", "verify execution"

---

## Instructions

When invoked, adopt the `ouroboros-evaluator` agent persona.

### Step 1: Load Context

Read `.claude/spec/agents/ouroboros-evaluator.md` and adopt that role.

Gather:
1. **Seed specification**: From `.claude-project/status/ouroboros/seeds/` or conversation
2. **Artifact to evaluate**: The implementation (files, output, etc.)
3. If neither available, ask the user what to evaluate against what criteria

### Step 2: Stage 1 — Mechanical Verification ($0)

Run automated checks. These cost nothing and catch obvious issues:

```bash
# TypeScript/JavaScript projects
npx tsc --noEmit                    # Type check
npm run lint 2>&1 | tail -20        # Lint
npm test 2>&1 | tail -30            # Tests
```

```bash
# Python projects
python -m py_compile {file}         # Syntax check
python -m pytest {test_dir} -q      # Tests
```

For each check, record PASS/FAIL:
- [ ] Lint: No errors
- [ ] Build/Compile: Succeeds
- [ ] Tests: All passing
- [ ] Coverage: ≥ 70% (if measurable)

**GATE**: If ANY mechanical check fails, STOP. Report failures and suggest fixes. Do NOT proceed to Stage 2.

### Step 3: Stage 2 — Semantic Evaluation

For each acceptance criterion from the seed:

1. **Evidence**: Search the codebase for concrete evidence (files, functions, tests)
2. **Completeness**: Is it fully implemented, not just partially?
3. **Quality**: Is the implementation sound? Any shortcuts or hacks?

Score each criterion as MET or NOT MET with evidence.

Calculate:
- **AC Compliance**: (criteria_met / total_criteria) × 100%
- **Goal Alignment**: 0.0-1.0 — how well does the whole serve the stated goal?
- **Drift Score**: 0.0-1.0 — how far from original spec? (lower = better)
  - `drift = 0.5 × goal_drift + 0.3 × constraint_drift + 0.2 × ontology_drift`
- **Overall Score**: Weighted by evaluation principles if defined in seed

**GATE**: Overall score must be ≥ 0.8. If passed and no Stage 3 trigger, APPROVE.

### Step 4: Stage 3 — Consensus (Only if Triggered)

**Triggers** (any one activates):
1. Drift score > 0.3
2. Stage 2 score in uncertain range (0.7-0.8)
3. User explicitly requests deep review
4. Ontology evolved since seed creation
5. Goal was reinterpreted during implementation

**Process**: Evaluate from 3 perspectives:

1. **Proposer**: Argues FOR approval based on seed criteria
2. **Devil's Advocate**: Argues AGAINST using ontological questioning — read `.claude/spec/agents/ouroboros-ontologist.md` for the questioning framework
3. **Synthesizer**: Weighs both arguments, makes final call

Each perspective gives APPROVE or REJECT with reasoning. 2/3 majority decides.

### Step 5: Report

Output the evaluation report:

```
Evaluation Report
=================

Stage 1: Mechanical Verification
- [PASS] Lint: No errors
- [PASS] Build: TypeScript compiled successfully
- [PASS] Tests: 12/12 passing
- [PASS] Coverage: 87%
Result: PASSED

Stage 2: Semantic Evaluation
AC Compliance:
- [MET] Webhooks retry with exponential backoff
- [MET] Max 5 retries per delivery
- [MET] Failed deliveries stored in PostgreSQL
- [NOT MET] Idempotency key not implemented
- [MET] Dashboard shows delivery status

AC Compliance: 80% (4/5)
Goal Alignment: 0.85
Drift Score: 0.12
Overall Score: 0.78
Result: FAILED (below 0.8 threshold)

Recommendations:
1. Implement idempotency key for webhook deliveries
2. Add test for duplicate delivery prevention

Stage 3: Not triggered

Final Decision: NEEDS WORK
```

### Step 6: Save Evaluation

Save to `.claude-project/status/ouroboros/evaluations/{eval_id}.json`:

```json
{
  "id": "eval-{uuid}",
  "seed_id": "{seed_id}",
  "timestamp": "{iso_date}",
  "stages": {
    "mechanical": { "passed": true, "checks": [...] },
    "semantic": { "passed": false, "score": 0.78, "ac_compliance": 0.80 },
    "consensus": null
  },
  "decision": "NEEDS_WORK",
  "recommendations": [...]
}
```

---

## Next Steps

- If APPROVED: Implementation meets spec. Proceed to merge/deploy.
- If NEEDS WORK: Fix the identified issues, then re-evaluate.
- If REJECTED (Stage 3): Fundamental issues found. Consider `/ouroboros:unstuck` or re-interview.
