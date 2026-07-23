# Story QA Validation Rules

Machine-verifiable rules. No subjective judgment.

## Rule 1: Route Coverage

**Check**: Every route in routes.yaml has at least 1 story in the generated files.

**FAIL condition**: `routes_without_stories.length > 0`

**How to check**:
1. Read routes.yaml → extract all route paths
2. Read all story files → extract all unique urls
3. Compare: any route path not in story urls = FAIL

**Fix**: Generate at least a smoke story (Tier 1) for the missing route.

---

## Rule 2: Duplicate Check

**Check**: No two stories share the same `name` field across all files.

**FAIL condition**: `duplicate_names.length > 0`

**How to check**:
1. Collect all story names across all files
2. Find duplicates

**Fix**: Rename duplicates to be unique (append route or tier info).

---

## Rule 3: YAML Format

**Check**: Every story has all required fields (name, tags, url, workflow).

**FAIL condition**: `stories_missing_fields.length > 0`

**How to check**:
1. Parse each story YAML entry
2. Verify presence of: name, tags, url, workflow
3. Verify auth is one of: none, user, admin

**Fix**: Add missing fields with appropriate defaults.

---

## Rule 4: Workflow Verb Validity

**Check**: All workflow steps use canonical verbs only.

**FAIL condition**: `invalid_verbs.length > 0`

**How to check**:
1. For each story's workflow, extract the first word(s) of each line
2. Check against canonical verb list in story-schema.yaml
3. Flag any non-matching verbs

**Fix**: Replace non-canonical verbs with closest canonical equivalent.

---

## Rule 5: Tier Balance

**Check**: For each route, if a tier is applicable (per Tier Applicability Rules), at least 1 story exists.

**FAIL condition**: `routes with applicable-but-uncovered tiers > 0`

**How to check**:
1. For each route, determine applicable tiers (from UI inventory / route classification)
2. For each applicable tier, check if at least 1 story has matching tags
3. Report missing tier-route combinations

**Fix**: Generate stories for uncovered applicable tiers.

---

## Rule 6: PRD Traceability

**Check**: Every entry in feature-story-map.md has at least 1 matching story.

**FAIL condition**: `unmapped_features.length > 0`

**How to check**:
1. Read feature-story-map.md → extract feature list
2. For each feature, check if a story's name or workflow references it
3. Features with no matching story = FAIL

**Fix**: Generate stories for unmapped features (at least Tier 1 smoke).

---

## Rule 7: Fixture Reference

**Check**: Stories that reference specific test data have matching entries in _fixtures.yaml.

**FAIL condition**: `broken_fixture_refs.length > 0`

**How to check**:
1. Scan workflows for quoted values that appear to be test data (emails, product names, etc.)
2. Check if those values exist in _fixtures.yaml
3. Values not in fixtures = FAIL

**Fix**: Either update fixtures to include the data, or change stories to use existing fixture data.

---

## QA Report Format

```markdown
# Story QA Report

## Summary
- Total rules: 7
- PASS: {N}
- FAIL: {N}
- Total stories checked: {N}

## Rule Results

### Rule 1: Route Coverage — {PASS/FAIL}
- Routes checked: {N}
- Routes covered: {N}
- Missing: {list of missing routes}

### Rule 2: Duplicate Check — {PASS/FAIL}
- Total names: {N}
- Duplicates: {list}

### Rule 3: YAML Format — {PASS/FAIL}
- Stories checked: {N}
- Missing fields: {list of {story_name: [missing_fields]}}

### Rule 4: Workflow Verb Validity — {PASS/FAIL}
- Lines checked: {N}
- Invalid verbs: {list of {story_name: line, verb}}

### Rule 5: Tier Balance — {PASS/FAIL}
- Applicable tiers checked: {N}
- Uncovered: {list of {route: tier}}

### Rule 6: PRD Traceability — {PASS/FAIL}
- Features checked: {N}
- Unmapped: {list}

### Rule 7: Fixture Reference — {PASS/FAIL}
- References checked: {N}
- Broken: {list}
```
