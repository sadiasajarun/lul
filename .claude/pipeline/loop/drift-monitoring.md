# Drift Monitoring

At Phase 10 (ship) and optionally between generations, check how far the implementation has drifted from the original seed specification.

## Drift Calculation

```
drift = 0.5 * goal_drift + 0.3 * constraint_drift + 0.2 * ontology_drift

goal_drift: Does the built product still serve the original goal?
constraint_drift: Were any constraints violated?
ontology_drift: Are the key entities/terms still as defined?
```

## Drift Actions

| Drift Score | Meaning | Action |
|-------------|---------|--------|
| <= 0.1 | On track | Ship confidently |
| 0.1 - 0.2 | Minor drift | Document what changed, ship |
| 0.2 - 0.4 | Moderate drift | Review with user: evolve spec or fix code? |
| > 0.4 | Major drift | STOP. Re-interview or major redesign needed |

If drift > 0.2, offer:
```
1. Evolve the spec (accept the drift, update seed)
2. Fix the code (revert drift, match original spec)
3. Re-interview (requirements fundamentally changed)
```
