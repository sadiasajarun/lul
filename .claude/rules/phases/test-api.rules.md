# Test API Phase Rules

## Process
- Backend API tests were generated in Phase 5b — execute them here
- Execute backend tests, 3 consecutive runs for stability
- Fix failures iteratively
- Frontend browser testing happens in Phase 9 (test-browser), NOT here

## Quality
- Tests must EXECUTE and PASS, not just compile
- Compiled-but-not-run tests score 0.0 (not a passing score)
- Flaky tests (pass sometimes, fail sometimes) count as failures
- At least 1 test per backend endpoint

## Scope Guard
- ONLY create test files under: backend/test/
- May fix source code bugs discovered by tests (both frontend/ and backend/)
- Do NOT add new features while fixing tests
- Do NOT modify design files
- Do NOT generate frontend Playwright .spec.ts files — that is handled by YAML user stories in Phase 9
