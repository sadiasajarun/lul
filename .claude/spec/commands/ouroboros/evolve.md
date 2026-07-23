---
description: Evolutionary loop — refine specs through iterative wonder/reflect cycles
---

# /ouroboros:evolve

Start or continue an evolutionary development loop. The serpent eats its tail — each evaluation cycle feeds back into better specifications.

## Usage

```
/ouroboros:evolve [context_or_seed_id]
```

**Trigger keywords:** "evolve", "evolutionary loop", "iterate until converged", "ooo evolve"

---

## How It Works

```
Gen 1: Interview → Seed(O₁) → Execute → Evaluate
         ↓
Gen 2: Wonder (What don't we know?) →
       Reflect (How should ontology evolve?) →
       Seed(O₂) → Execute → Evaluate
         ↓
Gen 3: ...continues until convergence...
```

Each generation refines the specification based on what was learned during execution and evaluation.

---

## Instructions

### Generation 1: Bootstrap

If starting fresh (no existing seed):

1. Run the interview flow (per `/ouroboros:interview`)
2. Generate the seed (per `/ouroboros:seed`)
3. Implement the seed specification
4. Evaluate (per `/ouroboros:evaluate`)
5. Record Generation 1 results

### Generation 2+: Evolve

For each subsequent generation:

#### Step 1: Wonder

Ask: "What do we still not know?"

Examine the previous generation's evaluation results:
- Which acceptance criteria were hard to meet? Why?
- What hidden requirements emerged during implementation?
- What assumptions proved wrong?
- What edge cases were discovered?

#### Step 2: Reflect

Ask: "How should the ontology evolve?"

Propose specific mutations:
- **Add fields**: New data discovered during implementation
- **Remove fields**: Fields that proved unnecessary
- **Modify types**: Type assumptions that were wrong
- **Add constraints**: New boundaries discovered
- **Refine AC**: Acceptance criteria that need adjustment

#### Step 3: Generate New Seed

Create Seed(O_{n}) with:
- Same immutable goal and core constraints
- Evolved ontology schema
- Refined acceptance criteria
- Updated evaluation principles

#### Step 4: Execute & Evaluate

Implement changes, then evaluate per `/ouroboros:evaluate`.

#### Step 5: Check Convergence

Compare current ontology with previous generation:

```
similarity = 0.5 × name_overlap + 0.3 × type_match + 0.2 × exact_match
```

Where:
- `name_overlap`: % of field names that match
- `type_match`: % of matching fields with same type
- `exact_match`: % of fields identical (name + type + description)

| Similarity | Status | Action |
|-----------|--------|--------|
| ≥ 0.95 | CONVERGED | Stop — ontology is stable |
| 0.80-0.95 | EVOLVING | Continue to next generation |
| < 0.80 | DIVERGING | Warning — major changes each cycle |

**Safety valve**: Max 30 generations.

### Progress Report

After each generation:

```
Evolution: Generation {n}
=========================
Ontology Similarity: {score} ({CONVERGED/EVOLVING/DIVERGING})

Wonder Insights:
- {insight 1}
- {insight 2}

Ontology Mutations:
- Added: {field_name} ({type})
- Removed: {field_name}
- Modified: {field_name} ({old_type} → {new_type})

Evaluation Score: {score}
Generations until convergence: ~{estimate}
```

---

## Key Concepts

| Concept | Question | Purpose |
|---------|----------|---------|
| **Wonder** | "What do we still not know?" | Surface gaps from evaluation |
| **Reflect** | "How should the ontology evolve?" | Propose specific mutations |
| **Convergence** | "Has the schema stabilized?" | Detect when evolution is complete |

---

## Example

```
User: /ouroboros:evolve seed-a1b2c3

Evolution: Generation 1
========================
Seed: webhook retry system
Evaluation: 0.78 (NEEDS WORK — idempotency missing)

Wonder Insights:
- Idempotency keys are essential for retry safety
- Sellers need visibility into delivery status
- Error categorization needed (retryable vs permanent)

Ontology Mutations:
- Added: idempotency_key (string)
- Added: error_category (enum: retryable|permanent|unknown)
- Modified: status (string → enum: pending|delivered|failed|exhausted)

Evolution: Generation 2
========================
Ontology Similarity: 0.82 (EVOLVING)
Evaluation: 0.92 (PASSED)

Wonder Insights:
- Circuit breaker pattern would prevent hammering dead endpoints
- Webhook signature verification needed for security

Ontology Mutations:
- Added: circuit_breaker_state (enum: closed|open|half_open)
- Added: signature_hash (string)

Evolution: Generation 3
========================
Ontology Similarity: 0.96 (CONVERGED)
Evaluation: 0.95 (PASSED)

Specification has stabilized. The ontology converged after 3 generations.
Final schema has 12 fields (started with 8).
```
