# QA Validation Rules — Technical PRD (Phase B)

> All rules use **only** counting/existence checks — no subjective judgment.

---

## Rule 9: Tech Stack Completeness

### Verification Method
1. Section 5 Technologies table is not empty
2. All services from Feature PRD Section 2's 3rd Party API List appear in Section 5
3. Key Decisions has at least 1 entry
4. Environment Variables has at least 1 entry

### PASS Condition
- Technologies table has minimum 5 layers
- All 3rd party services present in both Feature PRD Section 2 and Technical PRD Section 5
- Key Decisions ≥ 1
- Environment Variables ≥ 1

### FAIL Condition
- Technologies empty or < 5 layers
- 3rd party service missing from Section 5
- Key Decisions or Environment Variables empty

---

## Rule 10: Entity Coverage

### Verification Method
1. Identify CRUD-capable entities from Feature PRD Section 3/4
2. Verify each appears in Section 6 Entity List / Full Schema

### PASS Condition
- All CRUD entities from Feature PRD exist in Section 6

### FAIL Condition
- CRUD entity in Feature PRD but missing from Section 6

---

## Rule 11: Permission Completeness

### Verification Method
1. Identify edit/delete features in Feature PRD Section 3/4
2. Verify corresponding Resource × Action exists in Section 7
3. Check for empty cells

### PASS Condition
- All edit/delete features have Permission Matrix entries
- No empty cells in matrix

### FAIL Condition
- Feature without Permission Matrix entry
- Matrix contains empty cells

---

## Rule 14: Full Schema Completeness

### Verification Method
1. Extract all entities from Section 6 Entity Relationships
2. Check each has a Full Schema table
3. Verify minimum 5 columns (excl. timestamps)
4. Verify PK and FK columns present

### PASS Condition
- Every entity has Full Schema table
- Each ≥ 5 non-timestamp columns
- PK with generation strategy
- FK with `(FK → entity.column)` notation

### FAIL Condition
- Entity without Full Schema
- < 5 columns
- Missing PK or FK notation

---

## Rule 16: Config Uniqueness

### Verification Method
1. Read `docs/project-registry.md` for all registered projects
2. Compare Section 5 Environment Variables against every registered project

### PASS Condition
- Backend port unique
- Frontend ports no overlap
- Redis prefix unique
- Cookie names unique
- Database name unique

### FAIL Condition
- Any collision with existing project

### Evidence Format
```
Registry projects checked: {N}
Backend port {PORT}: [UNIQUE / COLLISION with {project}]
Frontend ports: [UNIQUE / COLLISION]
Redis prefix: [UNIQUE / COLLISION]
Cookie names: [UNIQUE / COLLISION]
DB name: [UNIQUE / COLLISION]
```

---

## Rule C1 (NEW): Cross-Phase Consistency

### Verification Method
1. Extract all entities referenced in Section 5-7
2. Compare against entities in Feature PRD Section 3/4
3. Verify no phantom entities (in tech PRD but not feature PRD)
4. Verify no missing entities (in feature PRD but not tech PRD)

### PASS Condition
- All entities in Section 6 correspond to CRUD entities in Feature PRD
- No phantom entities that don't exist in Feature PRD
- Status enums in Section 6 match Section 1 terms

### FAIL Condition
- Entity in Section 6 not traceable to Feature PRD
- CRUD entity in Feature PRD missing from Section 6
- Status enum mismatch

### Evidence Format
```
Feature PRD entities: {N}
Tech PRD entities: {M}
Phantom: [entity] — in Section 6 but not in Feature PRD
Missing: [entity] — in Feature PRD but not in Section 6
Enum mismatch: [enum] — Section 1 says [X], Section 6 says [Y]
```

---

## Rule C2 (NEW): FK Integrity

### Verification Method
1. Extract all FK references in Section 6 Full Schema
2. Verify each FK target entity and column exists in Section 6

### PASS Condition
- Every FK → entity.column references an existing entity and column

### FAIL Condition
- FK references non-existent entity or column

### Evidence Format
```
FK references: {N}
Valid: {M}
Invalid: [entity.column] → [target] — target not found in Section 6
```

---

## QA Output Format

```markdown
## QA Validation Results — Technical PRD

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 9 | Tech Stack Completeness | PASS/FAIL | {evidence} |
| 10 | Entity Coverage | PASS/FAIL | {evidence} |
| 11 | Permission Completeness | PASS/FAIL | {evidence} |
| 14 | Full Schema Completeness | PASS/FAIL | {evidence} |
| 16 | Config Uniqueness | PASS/FAIL | {evidence} |
| C1 | Cross-Phase Consistency | PASS/FAIL | {evidence} |
| C2 | FK Integrity | PASS/FAIL | {evidence} |

**Overall: PASS / FAIL**
```

### Rules
- NO subjective judgment
- ONLY counting, existence, and matching checks
- Each FAIL: specific evidence
- PASS requires ALL rules to pass
