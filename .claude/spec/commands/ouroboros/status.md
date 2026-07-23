---
description: Check session status and measure goal drift
---

# /ouroboros:status

Check session status and measure how far the implementation has drifted from the original specification.

## Usage

```
/ouroboros:status [session_id]
```

**Trigger keywords:** "am I drifting?", "drift check", "ooo status", "session status"

---

## Instructions

### Step 1: Gather Context

1. If `session_id` provided: Load from `.claude-project/status/ouroboros/sessions/{session_id}.json`
2. If a seed exists: Load from `.claude-project/status/ouroboros/seeds/`
3. If neither: Use conversation context to assess drift qualitatively

### Step 2: Assess Current State

Examine what's been built so far:
- Read recently modified files (use `git diff` or check conversation)
- Identify what features have been implemented
- Note any deviations from the original plan

### Step 3: Measure Drift

Calculate drift against the seed specification (or stated goals):

**Goal Drift** (weight: 50%)
- Are we still working toward the original objective?
- Have we added scope that wasn't in the spec?
- Have we dropped features that were required?

**Constraint Drift** (weight: 30%)
- Are all constraints still being respected?
- Have we violated any technical or business limits?
- Have we introduced new dependencies not in the spec?

**Ontology Drift** (weight: 20%)
- Has the data model changed from the spec?
- Are entity names and relationships as designed?
- Have fields been added, removed, or changed type?

**Formula:**
```
combined_drift = 0.5 × goal_drift + 0.3 × constraint_drift + 0.2 × ontology_drift
```

Each component scored 0.0 (no drift) to 1.0 (completely diverged).

### Step 4: Report

```
Session Status
==============
Session: {session_id or "conversation"}
Seed: {seed_id or "none"}
Status: {running/completed/stalled}

Drift Measurement
=================
Combined Drift: {score}
Status: {EXCELLENT/ACCEPTABLE/EXCEEDED}

Component Breakdown:
  Goal Drift:       {score} (50% weight) — {brief explanation}
  Constraint Drift: {score} (30% weight) — {brief explanation}
  Ontology Drift:   {score} (20% weight) — {brief explanation}

{Recommendation based on drift level}
```

### Drift Thresholds

| Combined Drift | Status | Action |
|----------------|--------|--------|
| 0.00 - 0.15 | EXCELLENT | On track. Keep going. |
| 0.15 - 0.30 | ACCEPTABLE | Monitor closely. Minor course corrections may help. |
| 0.30+ | EXCEEDED | Consider: re-interview, scope reduction, or `/ouroboros:unstuck` |

### Step 5: Recommendations

Based on drift level, suggest:

- **EXCELLENT**: "You're on track. Goal alignment is strong."
- **ACCEPTABLE**: "Minor drift detected in {area}. Consider {specific action}."
- **EXCEEDED**: "Significant drift. Options: 1) Re-run `/ouroboros:interview` to realign, 2) Run `/ouroboros:unstuck` to break through, 3) Accept the drift and update the seed."

---

## Without a Seed

If no seed exists, provide a qualitative assessment:

```
Drift Check (No Seed)
=====================
No formal seed specification found.

Based on conversation context:
- Original request: {what the user asked for}
- Current state: {what's been built}
- Apparent drift: {qualitative assessment}

Recommendation: Run /ouroboros:interview to formalize
requirements, then /ouroboros:seed to create a baseline.
```

---

## Example

```
User: am I drifting?

Session Status
==============
Session: conversation
Seed: seed-a1b2c3 (webhook retry system)

Drift Measurement
=================
Combined Drift: 0.18
Status: ACCEPTABLE

Component Breakdown:
  Goal Drift:       0.10 (50%) — Core retry logic implemented as specified
  Constraint Drift: 0.15 (30%) — Added Redis dependency not in original constraints
  Ontology Drift:   0.35 (20%) — Added 3 extra fields to delivery model

Minor drift detected in ontology. The extra fields may be
necessary but weren't in the spec. Consider documenting why
they were added, or running /ouroboros:evolve to update the seed.
```
