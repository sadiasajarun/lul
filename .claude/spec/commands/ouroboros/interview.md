---
description: Socratic interview to crystallize vague requirements before building
---

# /ouroboros:interview

Socratic interview to crystallize vague requirements into clear specifications.

## Usage

```
/ouroboros:interview [topic]
ooo: [topic]
```

**Trigger keywords:** "interview me", "clarify requirements", "ooo interview"

---

## Instructions

When invoked, adopt the `ouroboros-interviewer` agent persona and conduct a Socratic interview.

### Step 1: Load Agent Persona

Read `.claude/spec/agents/ouroboros-interviewer.md` and adopt that role entirely.

### Step 2: Establish Context

**If a PRD file path was provided** (via pipeline context from `--prd`):
1. Read the PRD file thoroughly
2. Analyze it for gaps in the three ambiguity dimensions (goal, constraints, success criteria)
3. Pre-score each dimension based on what the PRD already covers
4. Focus interview questions ONLY on weak dimensions and missing details
5. Reference the PRD in your questions: "Your PRD describes X — can you clarify Y?"
6. This is a **targeted gap-fill interview**, not a full interview from scratch

**If a topic was provided** (no PRD), use it as the starting point. If neither PRD nor topic, ask: "What are you trying to build or solve?"

If a codebase exists, use Read, Glob, Grep to explore relevant files for context before asking the first question. This grounds the interview in reality.

### Step 3: Conduct the Interview

Ask clarifying questions targeting the three ambiguity dimensions:

| Dimension | Weight | Key Questions |
|-----------|--------|---------------|
| Goal clarity | 40% | What exactly should this do? For whom? Why? |
| Constraint clarity | 30% | What boundaries exist? Technical limits? Business rules? |
| Success criteria | 30% | How will we verify it works? What does "done" look like? |

**Rules:**
- ALWAYS end your response with a question
- Ask ONE focused question at a time (not a list)
- Build on previous answers — reference what the user said
- Use ontological probing: "What IS this, really?", "Root cause or symptom?", "What are we assuming?"
- After gathering context with tools, always follow up with a question

### Step 4: Assess Ambiguity

After 5-8 questions, mentally score each dimension (0.0 = unclear, 1.0 = crystal clear):

```
ambiguity = 1 - (goal_clarity × 0.40 + constraint_clarity × 0.30 + success_clarity × 0.30)
```

| Score | Verdict |
|-------|---------|
| ≤ 0.2 | PASS — requirements are clear enough to proceed |
| 0.2-0.5 | CONTINUE — needs more clarification |
| > 0.5 | CONTINUE — still too vague |

### Step 5: Complete the Interview

When ambiguity ≤ 0.2 or the user says "done":

1. Present a brief summary of what was clarified
2. Show the ambiguity score breakdown:
   ```
   Interview Complete
   ==================
   Goal clarity:      {score}/1.0 (40%)
   Constraint clarity: {score}/1.0 (30%)
   Success criteria:   {score}/1.0 (30%)

   Ambiguity score: {score} — {PASS/NEEDS MORE WORK}
   ```
3. If PASS: Suggest running `/ouroboros:seed` to generate the specification
4. If still ambiguous: Note which dimensions need more work

### Step 6: Save Session State

Save interview record to `.claude-project/status/ouroboros/sessions/`:

```json
{
  "id": "sess-{uuid}",
  "topic": "{original topic}",
  "started_at": "{timestamp}",
  "questions": [
    { "q": "{question}", "a": "{answer}" }
  ],
  "scores": {
    "goal_clarity": 0.0,
    "constraint_clarity": 0.0,
    "success_criteria_clarity": 0.0
  },
  "ambiguity_score": 0.0,
  "status": "completed"
}
```

Create the directory if it doesn't exist.

---

## Example

```
User: /ouroboros:interview Build a webhook retry system

Claude (as interviewer):
What types of webhooks will this system handle — are these
outgoing webhooks your platform sends to external services,
or incoming webhooks you receive from third parties?

User: Outgoing. We send order status updates to seller endpoints.

Claude:
When a webhook delivery fails, what's the expected behavior —
should we retry immediately, use exponential backoff, or
let the seller configure their own retry preferences?

User: Exponential backoff with a max of 5 retries.

... (continues until clarity threshold met)

Interview Complete
==================
Goal clarity:       0.95/1.0 (40%)
Constraint clarity:  0.85/1.0 (30%)
Success criteria:    0.80/1.0 (30%)

Ambiguity score: 0.11 — PASS

Run /ouroboros:seed to generate the specification.
```

---

## Next Steps

After interview completion, run `/ouroboros:seed` to crystallize the specification.
