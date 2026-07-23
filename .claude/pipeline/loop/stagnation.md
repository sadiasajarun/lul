# Stagnation Detection

If a phase or the overall pipeline stops improving, detect and break through.

## Detection Patterns

| Pattern | Trigger | Handler |
|---------|---------|---------|
| **SPINNING** | Same score 3x in a row | Try different approach |
| **OSCILLATING** | Score alternates A->B->A->B | Structural problem, needs redesign |
| **PLATEAU** | Score improves < 0.01 per generation | Diminishing returns, may be good enough |

## Stagnation Handler

```
1. Identify stagnation type (spinning, oscillating, plateau)

2. For SPINNING:
   - Load .claude/spec/agents/ouroboros-hacker.md persona
   - "Make it work first, elegance later"
   - Try brute-force alternative approach

3. For OSCILLATING:
   - Load .claude/spec/agents/ouroboros-architect.md persona
   - "Rebuild the foundation"
   - Analyze why changes keep reverting, propose structural fix

4. For PLATEAU:
   - Load .claude/spec/agents/ouroboros-simplifier.md persona
   - "Cut to MVP"
   - Ask: is current score acceptable? Can we ship with this?

5. If pipeline_score > 0.7 and stagnation persists for 2+ generations:
   - Invoke ouroboros:evolve (see .claude/spec/commands/ouroboros/evolve.md)
   - Wonder: "What do we still not know?" — examine which phases keep failing and why
   - Reflect: "How should the specification evolve?" — propose seed mutations
   - Generate refined seed, then retry with evolved spec
   - This breaks the "same spec, different execution" loop

6. If still stuck after evolve:
   - Load .claude/spec/agents/ouroboros-contrarian.md persona
   - "What if we're solving the wrong problem?"
   - Present to user for decision
```
