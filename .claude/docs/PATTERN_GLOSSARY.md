# Pipeline Pattern Glossary

Pattern codes referenced by `RULE-*` entries in `.claude/rules/phases/*.rules.md`.
When adding a new rule, assign it a pattern code from below or create a new one.

---

## Agent Failure Patterns (A-series)

Patterns where the agent's behavior causes systemic failures beyond a single code error.

| Code | Name                | Description                                                                                                                                          | Rules   |
| ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A-01 | Field Name Mismatch | Agent uses wrong field names in API requests/responses (e.g., `body` vs `text`, `pinX` vs `x`), causing silent data loss                             | —       |
| A-08 | Bug Recurrence      | Agent fixes a bug but doesn't update the related user story YAML, so the same bug reappears in subsequent pipeline runs when stories are re-executed | RULE-T7 |

---

## Coverage Deception Patterns (D-series)

Patterns where test coverage appears healthy but is actually hollow — tests pass without verifying real behavior.

| Code | Name        | Description                                                                                                                                                                                                                             | Rules                     |
| ---- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| D-01 | Silent Pass | Tests appear to PASS but silently skip entire blocks via `.catch(() => false)` + `if`, or `test.skip(!seedAvailable)`. The report shows green while nothing was actually tested. Observed: 47/52 tests "PASS" with 41 silently skipped. | RULE-T2, RULE-T8, RULE-T9 |

---

## Conversion Fidelity Patterns (C-series)

Patterns where the HTML-to-React conversion phase produces output that diverges from the HTML prototypes.

| Code | Name                    | Description                                                                                                                                                                                                                                                               | Rules                                  |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| C-04 | Missing PRD Features    | Agent implements HTML structure but omits features specified in the PRD (e.g., i18n, accessibility, role guards)                                                                                                                                                          | RULE-F1, RULE-F5                       |
| C-05 | Independent Design      | Agent ignores HTML prototypes and designs UI structure independently, producing visually different layouts even when source HTML exists                                                                                                                                   | RULE-F7, RULE-F9                       |
| C-06 | CSS Value Drift         | Agent uses approximate CSS framework utility classes instead of exact values from HTML prototypes (e.g., using a utility that maps to 32px when HTML specifies 40px). Also applies to layout merging — e.g., combining role-specific layouts that should remain separate. | RULE-F8, RULE-F3                       |
| C-07 | Extra Feature Injection | Agent adds features not present in HTML prototypes (search inputs, view toggles, list/grid switches) during conversion, diverging from source                                                                                                                             | RULE-F10 (in blueprint, not rule file) |

---

## Global Patterns (GP-series)

Recurring patterns observed across 19+ projects (1165+ bug reports) in `bug-patterns-global.yaml`. When a GP pattern occurs 3+ times, it gets **promoted to a numbered RULE**.

| Code   | Name                        | Instances    | Description                                                                                                                                                                                                                                          | Promoted To |
| ------ | --------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| GP-001 | Hardcoded Mock Data         | 3+ projects  | Admin KPI cards, statistics pages, and table columns display hardcoded placeholder values instead of real API data. Users see fake numbers that never change.                                                                                        | RULE-F6     |
| GP-004 | Missing Computed Fields     | 9+ projects  | Backend returns raw ORM entities without computed fields (e.g., `membersCount`, `projectsCount`). Frontend shows 0 or undefined for counts. Also includes snake_case → camelCase mapping failures between ORM column names and frontend field names. | RULE-B1     |
| GP-008 | English-Only i18n Selectors | 35+ projects | Playwright tests use English-only text selectors (`page.locator('text=Submit')`) in apps where the default locale is not English, causing all tests to fail in non-English environments.                                                             | RULE-T6     |

---

## How to Add a New Pattern

When creating a new rule from an observed failure:

1. **Check if an existing pattern code fits** — browse categories above
2. **If new, assign the next code in the series** — e.g., if last A-series is A-08, new one is A-09
3. **Add it to this glossary** with: Code, Name, 1-sentence Description, and which RULE references it
4. **Add a `<!-- Why -->` block to the rule** following the format in rule files:
   ```
   <!-- Why: [What happened — past tense, observable failure]
        Pattern: [CODE] — [name]
        Ref: bug-patterns-global.yaml → [id] | agent-learnings → [LRN-id]
        Instances: [N projects/occurrences] -->
   ```
5. **Log the incident in `.claude-project/memory/LEARNINGS.md`** under the Rule Origins section

---

## Cross-References

| Source File                                                                            | What It Contains                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `.claude/skills/qa/learn-bugs/references/bug-patterns-global.yaml`                     | 112 bug patterns with symptoms, root causes, code signals, and case IDs |
| `.claude/skills/dev/generate-user-stories/references/agent-learnings/bug-pattern.yaml` | Agent-specific learnings (LRN-001 through LRN-005) tied to GP patterns  |
| `.claude/skills/dev/generate-user-stories/references/prompt-templates.md`              | GP pattern detection prompts used during user story generation          |
| `.claude/gates/*.sh`                                                                   | Gate scripts that enforce rules — comments reference pattern codes      |
