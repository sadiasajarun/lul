---
description: Generate immutable Seed specification from interview results
---

# /ouroboros:seed

Generate a validated Seed specification from interview results.

## Usage

```
/ouroboros:seed [session_id]
```

**Trigger keywords:** "crystallize", "generate seed", "ooo seed"

---

## Instructions

When invoked, adopt the `ouroboros-seed-architect` agent persona to extract structured requirements.

### Step 1: Load Agent Persona

Read `.claude/spec/agents/ouroboros-seed-architect.md` and adopt that role.

### Step 2: Find Interview Data

1. If `session_id` provided: Read from `.claude-project/status/ouroboros/sessions/{session_id}.json`
2. If no session_id: Look for the most recent interview in conversation history
3. If no interview found: Suggest running `/ouroboros:interview` first

### Step 3: Extract Seed Components

From the interview Q&A, extract:

| Component | Description |
|-----------|-------------|
| **goal** | One clear sentence: what + why |
| **constraints** | Hard limits (technical, business, design) |
| **acceptance_criteria** | Specific, measurable, testable criteria |
| **ontology_schema** | Domain model: entity names, fields, types |
| **evaluation_principles** | Quality metrics with weights (sum to 1.0) |
| **exit_conditions** | When to stop (success, failure, stagnation) |

### Step 4: Calculate Ambiguity Score

Use the interview scores if available, otherwise assess from conversation:

```
ambiguity = 1 - (goal_clarity × 0.40 + constraint_clarity × 0.30 + success_clarity × 0.30)
```

**Gate**: If ambiguity > 0.2, warn the user and suggest more interview rounds.

### Step 5: Generate Seed YAML

Output the specification in this format:

```yaml
# Seed Specification
# Generated: {date}
# Ambiguity Score: {score}
# Interview: {session_id}

goal: "{clear goal statement}"

constraints:
  - "{constraint 1}"
  - "{constraint 2}"

acceptance_criteria:
  - "{criterion 1}"
  - "{criterion 2}"
  - "{criterion 3}"

ontology_schema:
  name: "{DomainModelName}"
  description: "{what the model represents}"
  fields:
    - name: "{field_name}"
      type: "{string|number|boolean|array|object}"
      description: "{what this field represents}"

evaluation_principles:
  - name: "{principle}"
    description: "{what it measures}"
    weight: {0.0-1.0}

exit_conditions:
  - name: "success"
    description: "All acceptance criteria verified"
    criteria: "evaluation_score >= 0.8"
  - name: "max_iterations"
    description: "Safety valve"
    criteria: "iterations > 10"

metadata:
  version: "1.0"
  ambiguity_score: {score}
  interview_id: "{session_id}"
  created_at: "{timestamp}"
```

### Step 6: Save Seed

Save to `.claude-project/status/ouroboros/seeds/{seed_id}.yaml`

Create the directory if it doesn't exist.

### Step 7: Present to User

```
Seed Crystallized
=================
Goal: {goal summary}
Constraints: {count} defined
Acceptance Criteria: {count} defined
Ontology: {entity_name} with {field_count} fields
Ambiguity: {score}

Seed saved to: .claude-project/status/ouroboros/seeds/{seed_id}.yaml

Next steps:
- Implement the specification
- Run /ouroboros:evaluate to verify implementation
- Run /ouroboros:status to check drift
```

---

## Immutability Rule

The seed is FROZEN once generated:
- **Direction** (goal, constraints, AC) cannot change
- **Ontology** can evolve through `/ouroboros:evolve`
- To change direction, run a new interview → new seed

---

## Example

```
User: /ouroboros:seed

Seed Crystallized
=================
Goal: Build an exponential backoff webhook retry system for outgoing order status updates
Constraints: 3 defined (max 5 retries, PostgreSQL storage, idempotent delivery)
Acceptance Criteria: 5 defined
Ontology: WebhookDelivery with 8 fields
Ambiguity: 0.11

Seed saved to: .claude-project/status/ouroboros/seeds/seed-a1b2c3.yaml
```
