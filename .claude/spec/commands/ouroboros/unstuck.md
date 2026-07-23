---
description: Break through stagnation with lateral thinking personas
---

# /ouroboros:unstuck

Break through stagnation with lateral thinking personas.

## Usage

```
/ouroboros:unstuck [persona]
```

**Available personas:** `hacker`, `researcher`, `simplifier`, `architect`, `contrarian`

**Trigger keywords:** "I'm stuck", "think sideways", "ooo unstuck", "lateral thinking"

---

## Instructions

### Step 1: Determine Context

Before selecting a persona, understand the situation:

1. **What is the user stuck on?** — Check recent conversation, error messages, failed attempts
2. **What approaches have been tried?** — Avoid suggesting what already failed
3. **What pattern of stagnation?** — Identify the type (see detection below)

### Step 2: Detect Stagnation Pattern

| Pattern | Signs | Best Persona |
|---------|-------|-------------|
| **SPINNING** | Same error repeating, loop on same fix | **hacker** |
| **OSCILLATION** | Switching between two approaches, A→B→A | **architect** |
| **NO_DRIFT** | Progress flatlined, no improvement | **researcher** |
| **DIMINISHING_RETURNS** | Small gains getting smaller | **simplifier** |
| **ALL PATTERNS** | Multiple patterns or unclear | **contrarian** |

### Step 3: Select Persona

If the user specified a persona, use it. Otherwise, select based on the stagnation pattern above.

### Step 4: Load and Apply Persona

Read the agent definition from `.claude/spec/agents/`:

| Persona | Agent File | Core Question |
|---------|-----------|---------------|
| hacker | `ouroboros-hacker.md` | "What constraints are actually real?" |
| researcher | `ouroboros-researcher.md` | "What information are we missing?" |
| simplifier | `ouroboros-simplifier.md` | "What's the simplest thing that could work?" |
| architect | `ouroboros-architect.md` | "Is the structure wrong?" |
| contrarian | `ouroboros-contrarian.md` | "What if we're solving the wrong problem?" |

Adopt the persona entirely and apply it to the current problem.

### Step 5: Generate Lateral Thinking Output

The persona should produce:

```
Lateral Thinking: {Persona Name}
=================================
Pattern detected: {SPINNING/OSCILLATION/NO_DRIFT/DIMINISHING_RETURNS}

Reframing:
{The persona's reframing of the problem — 2-3 sentences}

Questions to Consider:
1. {Question that challenges current approach}
2. {Question that opens new direction}
3. {Question that simplifies the problem}

Suggested Next Steps:
1. {Concrete, actionable step}
2. {Concrete, actionable step}
3. {Concrete, actionable step}
```

### Step 6: Offer Follow-up

After presenting the lateral thinking result, ask if the user wants to:
- Try a different persona for another perspective
- Proceed with one of the suggested steps
- Return to the original approach with new insight

---

## Quick Reference

```
/ouroboros:unstuck              → Auto-detect best persona
/ouroboros:unstuck hacker       → "Make it work, elegance later"
/ouroboros:unstuck researcher   → "Stop coding. Read the docs."
/ouroboros:unstuck simplifier   → "Cut to MVP"
/ouroboros:unstuck architect    → "Rebuild the foundation"
/ouroboros:unstuck contrarian   → "What if we're wrong about everything?"
```

---

## Example

```
User: I've been trying to fix this auth middleware for an hour.
      The JWT validation keeps failing but the token looks correct.

/ouroboros:unstuck

Lateral Thinking: Researcher
=============================
Pattern detected: SPINNING (same error, multiple fix attempts)

Reframing:
We're assuming the token is correct because it "looks right."
But JWT validation involves multiple components — signing key,
algorithm, expiration, issuer — any of which could mismatch.

Questions to Consider:
1. Have you decoded the token and compared EVERY claim against
   what the middleware expects?
2. Is the signing key the same one used to generate the token?
3. Are you comparing against the right environment's keys?

Suggested Next Steps:
1. Decode the token at jwt.io and list every claim
2. Print the exact validation error (not just "invalid token")
3. Compare the signing key byte-by-byte between generator and validator
```
