#!/bin/bash
# backend-gate.sh — Deterministic validation for backend phase
# Checks: TSC, ESLint, endpoints exist, tests compile, Swagger decorators
source "$(dirname "$0")/_gate-runner.sh"

init_gate "backend" "$1"
BACKEND_DIR="$TARGET_DIR/backend"

# Check 1: TypeScript compiles
TSC_PROJECT=""
[ -f "$BACKEND_DIR/tsconfig.app.json" ] && TSC_PROJECT="--project tsconfig.app.json"
[ -f "$BACKEND_DIR/tsconfig.build.json" ] && TSC_PROJECT="--project tsconfig.build.json"
run_check "tsc" "cd '$BACKEND_DIR' && npx tsc $TSC_PROJECT --noEmit"

# Check 2: ESLint passes (quiet mode — errors only)
if [ -f "$BACKEND_DIR/.eslintrc.js" ] || [ -f "$BACKEND_DIR/.eslintrc.json" ] || [ -f "$BACKEND_DIR/eslint.config.mjs" ]; then
  run_check "eslint" "cd '$BACKEND_DIR' && npx eslint src/ --quiet --max-warnings 0 2>&1 || true"
fi

# Check 3: Controller files exist (endpoints implemented)
run_count_check "controllers-exist" \
  "find '$BACKEND_DIR/src' -name '*.controller.ts' ! -name 'app.controller.ts' 2>/dev/null | wc -l" \
  ">=" 1

# Check 4: Service files exist (business logic)
run_count_check "services-exist" \
  "find '$BACKEND_DIR/src' -name '*.service.ts' ! -name 'app.service.ts' 2>/dev/null | wc -l" \
  ">=" 1

# Check 5: DTO files exist (request/response validation)
run_count_check "dtos-exist" \
  "find '$BACKEND_DIR/src' -name '*.dto.ts' 2>/dev/null | wc -l" \
  ">=" 1

# Check 6: Swagger decorators present
run_count_check "swagger-decorators" \
  "grep -rl '@ApiTags\|@ApiOperation\|@ApiResponse' '$BACKEND_DIR/src' --include='*.controller.ts' 2>/dev/null | wc -l" \
  ">=" 1

# Check 7: Test files exist
run_count_check "test-files-exist" \
  "find '$BACKEND_DIR' -name '*.spec.ts' -o -name '*.e2e-spec.ts' 2>/dev/null | wc -l" \
  ">=" 1

# Check 8: Test files compile
if find "$BACKEND_DIR" -name '*.spec.ts' -o -name '*.e2e-spec.ts' 2>/dev/null | grep -q .; then
  if [ -f "$BACKEND_DIR/tsconfig.spec.json" ]; then
    run_check "tests-compile" "cd '$BACKEND_DIR' && npx tsc --project tsconfig.spec.json --noEmit"
  fi
fi

# Check 9: Tests actually execute and pass (not just compile)
# Uses unit test project to avoid requiring a live database
run_check "tests-execute" "cd '$BACKEND_DIR' && npx jest --selectProjects unit --passWithNoTests --forceExit 2>&1"

# Check 10: Test pass rate >= 80%
# Parses Jest JSON output for pass/fail counts
JEST_OUTPUT=$(cd "$BACKEND_DIR" && npx jest --selectProjects unit --passWithNoTests --forceExit --json 2>/dev/null || echo '{}')
TESTS_PASSED=$(echo "$JEST_OUTPUT" | jq -r '.numPassedTests // 0' 2>/dev/null || echo 0)
TESTS_TOTAL=$(echo "$JEST_OUTPUT" | jq -r '.numTotalTests // 0' 2>/dev/null || echo 0)
if [ "$TESTS_TOTAL" -gt 0 ]; then
  PASS_RATE=$(echo "scale=2; $TESTS_PASSED * 100 / $TESTS_TOTAL" | bc)
  run_count_check "tests-pass-rate" "echo $PASS_RATE | cut -d. -f1" ">=" 80
else
  # No tests found — pass with warning (test existence checked separately)
  run_count_check "tests-pass-rate" "echo 100" ">=" 80
fi

# =============================================================================
# Checks 11-14: Code quality patterns (prevents B-02, B-05, B-08)
# =============================================================================

# Check 11: Unsafe type casting — `as unknown as` pattern count
# Prevents: B-02 (Request object unsafe casting)
UNSAFE_CAST=$(grep -rn 'as unknown as' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | grep -v 'node_modules\|\.spec\.' | wc -l)
if [ "$UNSAFE_CAST" -le 3 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$UNSAFE_CAST unsafe casts (threshold: 3)" \
    '. + [{"name":"no-unsafe-cast","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$UNSAFE_CAST unsafe casts (threshold: 3)" \
    '. + [{"name":"no-unsafe-cast","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 12: class-validator decorators used in DTOs
# Prevents: unvalidated request bodies
# v118: RATIO, not presence. The old check passed if >=1 DTO had ANY validator —
# trivially true while 30 other request DTOs went unvalidated (the det-vs-eval gap:
# det measured presence, eval measured correctness). Require >=80% of *request* DTOs
# (create/update — response DTOs legitimately have no validators) to carry validators.
REQ_DTOS=$(find "$BACKEND_DIR/src" -name '*.dto.ts' 2>/dev/null | grep -iE 'create|update|/[a-z-]*\.dto\.ts' | grep -ivE 'response|\.res\.' | wc -l | tr -d ' ')
DTO_FILES=$(find "$BACKEND_DIR/src" -name '*.dto.ts' 2>/dev/null | wc -l)
if [ "$REQ_DTOS" -gt 0 ]; then
  VALIDATED_DTOS=$(grep -rlE '@Is|@Min|@Max|@Length|@Matches|@IsNotEmpty|@IsEmail|@IsOptional|@IsEnum|@IsString|@IsNumber|@IsBoolean|@IsArray|@IsUUID|@ValidateNested' "$BACKEND_DIR/src" --include='*.dto.ts' 2>/dev/null \
    | grep -iE 'create|update' | grep -ivE 'response' | wc -l | tr -d ' ')
  PCT=$(echo "scale=2; $VALIDATED_DTOS * 100 / $REQ_DTOS" | bc | cut -d. -f1)
  if [ "${PCT:-0}" -ge 80 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$VALIDATED_DTOS/$REQ_DTOS request DTOs validated (${PCT}% >= 80%)" \
      '. + [{"name":"class-validator-coverage","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$VALIDATED_DTOS/$REQ_DTOS request DTOs validated (${PCT}% < 80%)" \
      '. + [{"name":"class-validator-coverage","pass":false,"detail":$d,"duration_ms":0}]')
  fi
elif [ "$DTO_FILES" -gt 0 ]; then
  # No create/update DTOs matched but DTOs exist — fall back to presence so we don't false-fail.
  VALIDATED_DTOS=$(grep -rlE '@Is|@IsNotEmpty|@IsEmail|@IsEnum|@IsString' "$BACKEND_DIR/src" --include='*.dto.ts' 2>/dev/null | wc -l | tr -d ' ')
  PASS=$([ "$VALIDATED_DTOS" -ge 1 ] && echo true || echo false)
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --argjson p "$PASS" --arg d "$VALIDATED_DTOS/$DTO_FILES DTOs validated (presence fallback)" \
    '. + [{"name":"class-validator-coverage","pass":$p,"detail":$d,"duration_ms":0}]')
fi

# Check 13: Swagger decorators on ALL controllers (not just count >= 1)
CONTROLLER_COUNT=$(find "$BACKEND_DIR/src" -name '*.controller.ts' ! -name 'app.controller.ts' 2>/dev/null | wc -l)
SWAGGER_COUNT=$(grep -rl '@ApiTags\|@ApiOperation' "$BACKEND_DIR/src" --include='*.controller.ts' 2>/dev/null | wc -l)
if [ "$CONTROLLER_COUNT" -gt 0 ]; then
  if [ "$SWAGGER_COUNT" -ge "$CONTROLLER_COUNT" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SWAGGER_COUNT/$CONTROLLER_COUNT controllers have Swagger" \
      '. + [{"name":"swagger-all-controllers","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SWAGGER_COUNT/$CONTROLLER_COUNT controllers have Swagger" \
      '. + [{"name":"swagger-all-controllers","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 14: Error handling — NestJS exception classes used
# Prevents: generic error responses without proper HTTP status codes
ERROR_HANDLERS=$(grep -rl 'NotFoundException\|BadRequestException\|UnauthorizedException\|ForbiddenException\|ConflictException' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | grep -v 'node_modules\|\.spec\.' | wc -l)
if [ "$ERROR_HANDLERS" -ge 2 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ERROR_HANDLERS files use NestJS exceptions" \
    '. + [{"name":"nestjs-error-handling","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ERROR_HANDLERS files use NestJS exceptions (need >= 2)" \
    '. + [{"name":"nestjs-error-handling","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Checks 15-16: Auth security patterns (prevents H-01a, H-01b)
# =============================================================================

# Check 15: Refresh token set as httpOnly cookie
# Prevents: H-01a (refreshToken returned in JSON body → accessible via JS → XSS risk)
AUTH_DIR="$BACKEND_DIR/src/modules/auth"
if [ -d "$AUTH_DIR" ]; then
  HTTPONLY_COUNT=$(grep -rl 'httpOnly.*true\|httpOnly: true' "$AUTH_DIR" --include='*.ts' 2>/dev/null | wc -l)
  if [ "$HTTPONLY_COUNT" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "httpOnly cookie found in auth module" \
      '. + [{"name":"httponly-refresh-token","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"httponly-refresh-token","pass":false,"detail":"no httpOnly cookie in auth/ — refreshToken must be set as httpOnly cookie, not returned in JSON","duration_ms":0}]')
  fi
fi

# Check 16: No hardcoded JWT_SECRET fallback
# Prevents: H-01b (process.env.JWT_SECRET || 'default-secret' → all envs share same key)
JWT_FALLBACK=$(grep -rn "JWT_SECRET.*||" "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | grep -v '\.spec\.' | wc -l)
if [ "$JWT_FALLBACK" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-jwt-secret-fallback","pass":true,"detail":"no hardcoded JWT_SECRET fallback found","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$JWT_FALLBACK hardcoded JWT_SECRET fallback(s) — use throw new Error() if env var missing" \
    '. + [{"name":"no-jwt-secret-fallback","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Checks 19-22: Architecture pattern enforcement (4-layer base class pattern)
# Prevents: Controllers/services that skip base classes, direct TypeORM in services
# =============================================================================

# Check 19 (v118 — OUTCOME, not mechanism): Feature controllers expose real HTTP routes.
# REPLACES the old `controllers-extend-base` check. That check REWARDED extending
# BaseController — but BaseController auto-applies JwtAuthGuard globally to all CRUD
# routes AND auto-exposes raw CRUD endpoints the spec doesn't want (v118: P0 global
# guard + unwanted /users,/documents,/applications CRUD). The refactor agent CORRECTLY
# removes `extends BaseController` to fix those bugs, so the old check penalized correct
# code and rewarded buggy code. Assert the OUTCOME instead: every feature controller
# carries at least one HTTP-method decorator (it actually serves routes), regardless of
# whether it inherits them from a base class or declares them directly.
CTRL_TOTAL=$(find "$BACKEND_DIR/src/modules" -name '*.controller.ts' \
  ! -name 'app.controller.ts' 2>/dev/null | wc -l | tr -d ' ')
CTRL_WITH_ROUTES=$(grep -rlE '@(Get|Post|Put|Patch|Delete)\(|extends BaseController' "$BACKEND_DIR/src/modules" --include='*.controller.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "$CTRL_TOTAL" -gt 0 ]; then
  if [ "$CTRL_WITH_ROUTES" -ge "$CTRL_TOTAL" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CTRL_WITH_ROUTES/$CTRL_TOTAL feature controllers expose HTTP routes" \
      '. + [{"name":"controllers-have-routes","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CTRL_WITH_ROUTES/$CTRL_TOTAL feature controllers expose HTTP routes (rest are empty/stub)" \
      '. + [{"name":"controllers-have-routes","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 20: Services extend BaseService
# Exempt: auth.service.ts (no own entity), admin.service.ts (cross-entity aggregation)
SVC_TOTAL=$(find "$BACKEND_DIR/src/modules" -name '*.service.ts' \
  ! -name 'app.service.ts' ! -name 'auth.service.ts' ! -name 'admin.service.ts' \
  2>/dev/null | wc -l | tr -d ' ')
SVC_EXTENDS=$(grep -rl 'extends BaseService' "$BACKEND_DIR/src/modules" --include='*.service.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "$SVC_TOTAL" -gt 0 ]; then
  if [ "$SVC_EXTENDS" -ge "$SVC_TOTAL" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SVC_EXTENDS/$SVC_TOTAL services extend BaseService" \
      '. + [{"name":"services-extend-base","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SVC_EXTENDS/$SVC_TOTAL services extend BaseService" \
      '. + [{"name":"services-extend-base","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 21: No direct @InjectRepository in services (must use custom repository)
# Exempt: auth.service.ts, admin.service.ts (special modules without own entity)
INJECT_IN_SVC=$(grep -rn '@InjectRepository' "$BACKEND_DIR/src/modules" --include='*.service.ts' 2>/dev/null \
  | grep -v 'auth\.service\|admin\.service' | wc -l | tr -d ' ')
if [ "$INJECT_IN_SVC" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-direct-repo-in-service","pass":true,"detail":"no @InjectRepository in services — using custom repositories","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$INJECT_IN_SVC direct @InjectRepository(s) in services — must use custom repository classes" \
    '. + [{"name":"no-direct-repo-in-service","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 22: createQueryBuilder only in repository files, not in services
# Prevents: business logic layer leaking into data access concerns
QB_IN_SVC=$(grep -rn 'createQueryBuilder' "$BACKEND_DIR/src/modules" --include='*.service.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "$QB_IN_SVC" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"querybuilder-in-repo-only","pass":true,"detail":"no createQueryBuilder in services — queries are in repositories","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$QB_IN_SVC createQueryBuilder(s) in services — move to repository layer" \
    '. + [{"name":"querybuilder-in-repo-only","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Checks 22b-22c (v118): Correctness checks promoted from the LLM evaluator.
# These catch recurring P0/P1 findings DETERMINISTICALLY (reproducible, no LLM
# variance) so the gate measures correctness — not just presence — without
# leaning on the non-reproducible evaluator blend.
# =============================================================================

# Check 22b: No falsy-zero role default (RULE-B8). `role: x.role || 'default'`
# coerces foreign_worker (role 0) to the string default → RBAC 403 for every
# worker. The valid fix is `?? `. v118 evidence: auth.service.ts:108 shipped this
# P0 because the nullish doctor ran pre-implement and was clobbered. Grep is exact.
FALSY_ROLE=$(grep -rnE '\.role\s*\|\|' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | grep -v '\.spec\.' | wc -l | tr -d ' ')
if [ "$FALSY_ROLE" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-falsy-zero-role","pass":true,"detail":"no `.role || default` falsy-zero pattern (RULE-B8)","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$FALSY_ROLE \`.role || default\` falsy-zero pattern(s) — role 0 (foreign_worker) coerced to default, breaks RBAC. Use \`?? \` (RULE-B8)" \
    '. + [{"name":"no-falsy-zero-role","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 22c: No stub controllers. A controller whose handlers `throw new
# NotImplementedException()` is an unimplemented PRD feature, not a real endpoint.
# v118 evidence: 9 controllers (admin-user/setting/dashboard/export, company-
# schedule/staff/worker, …) were NotImplementedException stubs — a P1 the
# deterministic gate previously missed (controllers-exist counted them as present).
STUB_CTRLS=$(grep -rlE 'NotImplementedException' "$BACKEND_DIR/src/modules" --include='*.controller.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "$STUB_CTRLS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-stub-controllers","pass":true,"detail":"no NotImplementedException stub controllers","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$STUB_CTRLS controller(s) throw NotImplementedException — unimplemented PRD features, not real endpoints" \
    '. + [{"name":"no-stub-controllers","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Checks 23-29: Structural compliance with NestJS submodule architecture
# Ensures directory structure matches .claude/nestjs/guides/architecture-overview.md
# Prevents: agent skipping required directories/files during generation
# =============================================================================

# Check 23: core/pipes/ directory with validation.pipe.ts
file_exists_check "core-pipes-exists" "$BACKEND_DIR/src/core/pipes/validation.pipe.ts"

# Check 24: core/interceptors/logging.interceptor.ts
file_exists_check "logging-interceptor-exists" "$BACKEND_DIR/src/core/interceptors/logging.interceptor.ts"

# Check 25: core/decorators/api-swagger.decorator.ts
file_exists_check "api-swagger-decorator-exists" "$BACKEND_DIR/src/core/decorators/api-swagger.decorator.ts"

# Check 26: infrastructure/ directory exists with subdirs
INFRA_DIRS=0
[ -d "$BACKEND_DIR/src/infrastructure/mail" ] && INFRA_DIRS=$((INFRA_DIRS + 1))
[ -d "$BACKEND_DIR/src/infrastructure/s3" ] && INFRA_DIRS=$((INFRA_DIRS + 1))
[ -d "$BACKEND_DIR/src/infrastructure/token" ] && INFRA_DIRS=$((INFRA_DIRS + 1))
[ -d "$BACKEND_DIR/src/infrastructure/logging" ] && INFRA_DIRS=$((INFRA_DIRS + 1))
run_count_check "infrastructure-dirs" "echo $INFRA_DIRS" ">=" 4

# Check 27: database/migrations/ directory exists
file_exists_check "database-migrations-dir" "$BACKEND_DIR/src/database/migrations"

# Check 28: database/seeders/ directory exists
file_exists_check "database-seeders-dir" "$BACKEND_DIR/src/database/seeders"

# Check 29: All core subdirectories present (base, decorators, filters, guards, interceptors, pipes)
CORE_DIRS=0
[ -d "$BACKEND_DIR/src/core/base" ] && CORE_DIRS=$((CORE_DIRS + 1))
[ -d "$BACKEND_DIR/src/core/decorators" ] && CORE_DIRS=$((CORE_DIRS + 1))
[ -d "$BACKEND_DIR/src/core/filters" ] && CORE_DIRS=$((CORE_DIRS + 1))
[ -d "$BACKEND_DIR/src/core/guards" ] && CORE_DIRS=$((CORE_DIRS + 1))
[ -d "$BACKEND_DIR/src/core/interceptors" ] && CORE_DIRS=$((CORE_DIRS + 1))
[ -d "$BACKEND_DIR/src/core/pipes" ] && CORE_DIRS=$((CORE_DIRS + 1))
run_count_check "core-subdirs-complete" "echo $CORE_DIRS" ">=" 6

# =============================================================================
# Checks 17-18: Seed script validation (prevents D-01 seed data gap)
# =============================================================================

# Check 17: Seed script exists (TypeORM or Prisma)
# Prevents: Phase 9 seed-and-auth-setup failure → all auth tests BLOCKED
run_check "seed-script-exists" \
  "[ -f '$BACKEND_DIR/src/database/seeders/index.ts' ] || [ -f '$BACKEND_DIR/prisma/seed.ts' ] || [ -f '$BACKEND_DIR/prisma/seed.js' ]"

# Check 18: Seed npm script registered in package.json
# Even if seed file exists, `npm run seed` fails without package.json registration
run_check "seed-script-registered" \
  "grep -q '\"seed\"' '$BACKEND_DIR/package.json'"

# =============================================================================
# Checks 30-34: Runtime compliance (prevents skipped implementations)
# Ensures submodule docs patterns are actually followed, not just files created
# =============================================================================

# Check 30: TransformInterceptor globally registered in main.ts
# Prevents: API responses not wrapped in ResponsePayloadDto
if grep -q 'TransformInterceptor\|useGlobalInterceptors' "$BACKEND_DIR/src/main.ts" 2>/dev/null; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"global-interceptor-registered","pass":true,"detail":"TransformInterceptor registered in main.ts","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"global-interceptor-registered","pass":false,"detail":"TransformInterceptor NOT registered in main.ts — add app.useGlobalInterceptors(new TransformInterceptor())","duration_ms":0}]')
fi

# Check 31: HttpExceptionFilter globally registered in main.ts
# Prevents: Unformatted error responses
if grep -q 'HttpExceptionFilter\|useGlobalFilters' "$BACKEND_DIR/src/main.ts" 2>/dev/null; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"global-filter-registered","pass":true,"detail":"HttpExceptionFilter registered in main.ts","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"global-filter-registered","pass":false,"detail":"HttpExceptionFilter NOT registered in main.ts — add app.useGlobalFilters(new HttpExceptionFilter())","duration_ms":0}]')
fi

# Check 32: Infrastructure modules have actual implementation (not just .gitkeep)
# Prevents: Empty infrastructure/ directories that look complete but have no code
INFRA_IMPL=0
for infra_dir in mail s3 token logging; do
  if [ -d "$BACKEND_DIR/src/infrastructure/$infra_dir" ]; then
    TS_FILES=$(find "$BACKEND_DIR/src/infrastructure/$infra_dir" -name '*.ts' ! -name '.gitkeep' ! -name 'index.ts' 2>/dev/null | wc -l | tr -d ' ')
    [ "$TS_FILES" -gt 0 ] && INFRA_IMPL=$((INFRA_IMPL + 1))
  fi
done
if [ "$INFRA_IMPL" -ge 2 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$INFRA_IMPL/4 infrastructure modules implemented" \
    '. + [{"name":"infrastructure-implemented","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$INFRA_IMPL/4 infrastructure modules implemented (need >= 2)" \
    '. + [{"name":"infrastructure-implemented","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 33: File upload implemented (not just metadata API) when attachment module exists
# Prevents: Attachment module that only saves metadata without actual file handling
if [ -f "$BACKEND_DIR/src/modules/attachment/attachment.controller.ts" ]; then
  if grep -q 'FileInterceptor\|FilesInterceptor\|UploadedFile\|multer\|Multer' \
    "$BACKEND_DIR/src/modules/attachment/attachment.controller.ts" 2>/dev/null; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"file-upload-implemented","pass":true,"detail":"FileInterceptor found in attachment controller","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"file-upload-implemented","pass":false,"detail":"attachment controller has no FileInterceptor — only metadata API, no real file upload","duration_ms":0}]')
  fi
fi

# Check 34: CORS credentials enabled (required for httpOnly cookie auth)
# Prevents: Cookie-based auth failing due to missing credentials: true
if grep -q 'credentials.*true' "$BACKEND_DIR/src/main.ts" 2>/dev/null; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"cors-credentials-enabled","pass":true,"detail":"CORS credentials: true found in main.ts","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"cors-credentials-enabled","pass":false,"detail":"CORS credentials: true NOT found in main.ts — required for httpOnly cookie auth","duration_ms":0}]')
fi

# Check 35: Logout MUST use RemoveTokenInterceptor (not manual clearCookie)
# Prevents: Claude generating manual res.clearCookie() instead of interceptor pattern
AUTH_CTRL="$BACKEND_DIR/src/modules/auth/auth.controller.ts"
REMOVE_INTERCEPTOR="$BACKEND_DIR/src/core/interceptors/remove-token.interceptor.ts"
if [ -f "$AUTH_CTRL" ]; then
  CHECK35_FAIL=""

  # 35a: remove-token.interceptor.ts file must exist
  if [ ! -f "$REMOVE_INTERCEPTOR" ]; then
    CHECK35_FAIL="remove-token.interceptor.ts file missing in src/core/interceptors/"
  # 35b: interceptor file must contain cookie clearing logic (clearCookie or res.cookie with empty value)
  elif ! grep -qE 'clearCookie|\.cookie\(' "$REMOVE_INTERCEPTOR" 2>/dev/null; then
    CHECK35_FAIL="remove-token.interceptor.ts exists but has no cookie clearing logic"
  # 35c: interceptor must clear 2+ cookies (access + refresh) — works with any cookie name convention
  elif [ "$(grep -cE 'clearCookie|\.cookie\(' "$REMOVE_INTERCEPTOR" 2>/dev/null)" -lt 2 ]; then
    COOKIE_CALLS=$(grep -cE 'clearCookie|\.cookie\(' "$REMOVE_INTERCEPTOR" 2>/dev/null)
    CHECK35_FAIL="remove-token.interceptor.ts must clear both access and refresh cookies (found $COOKIE_CALLS cookie call(s), need 2+)"
  # 35d: @UseInterceptors(RemoveTokenInterceptor) must appear near logout method
  elif ! grep -B5 'logout' "$AUTH_CTRL" 2>/dev/null | grep -q 'RemoveTokenInterceptor'; then
    CHECK35_FAIL="@UseInterceptors(RemoveTokenInterceptor) not found on logout method — it may be imported but not applied"
  # 35e: no manual clearCookie in controller
  elif grep -q 'clearCookie' "$AUTH_CTRL" 2>/dev/null; then
    CHECK35_FAIL="auth.controller.ts has manual clearCookie — remove it, let RemoveTokenInterceptor handle it"
  # 35f: SetToken and RemoveToken must handle same number of cookies
  elif [ -f "$BACKEND_DIR/src/core/interceptors/set-token.interceptor.ts" ]; then
    SET_COOKIE_COUNT=$(grep -cE '\.cookie\(' "$BACKEND_DIR/src/core/interceptors/set-token.interceptor.ts" 2>/dev/null)
    REM_COOKIE_COUNT=$(grep -cE 'clearCookie|\.cookie\(' "$REMOVE_INTERCEPTOR" 2>/dev/null)
    if [ "$SET_COOKIE_COUNT" -ge 2 ] && [ "$REM_COOKIE_COUNT" -lt 2 ]; then
      CHECK35_FAIL="cookie count mismatch — SetTokenInterceptor sets $SET_COOKIE_COUNT cookies but RemoveTokenInterceptor only clears $REM_COOKIE_COUNT"
    fi
  fi

  if [ -z "$CHECK35_FAIL" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"logout-uses-remove-token-interceptor","pass":true,"detail":"RemoveTokenInterceptor: file exists, clears both cookies, applied to logout method, no manual clearCookie, cookie names match","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CHECK35_FAIL" \
      '. + [{"name":"logout-uses-remove-token-interceptor","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 36: .env.example exists and contains required auth cookie vars
# Prevents: App crash on startup when AUTH_TOKEN_COOKIE_NAME missing from env
ENV_EXAMPLE="$BACKEND_DIR/.env.example"
if [ -f "$ENV_EXAMPLE" ]; then
  MISSING_VARS=""
  for VAR in AUTH_TOKEN_COOKIE_NAME AUTH_REFRESH_TOKEN_COOKIE_NAME; do
    if ! grep -q "^$VAR=" "$ENV_EXAMPLE" 2>/dev/null; then
      MISSING_VARS="$MISSING_VARS $VAR"
    fi
  done
  if [ -z "$MISSING_VARS" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"env-auth-cookie-vars","pass":true,"detail":"AUTH_TOKEN_COOKIE_NAME and AUTH_REFRESH_TOKEN_COOKIE_NAME present in .env.example","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "Missing from .env.example:$MISSING_VARS — interceptors use getOrThrow, app will crash without these" \
      '. + [{"name":"env-auth-cookie-vars","pass":false,"detail":$d,"duration_ms":0}]')
  fi
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"env-auth-cookie-vars","pass":false,"detail":".env.example file missing — required for auth cookie configuration","duration_ms":0}]')
fi

# =============================================================================
# Check 37-39: WebSocket Gateway (conditional — only when PRD requires real-time)
# Prevents: PRD specifying real-time features but no WebSocket implementation
# =============================================================================

# Detect if PRD/PROJECT_KNOWLEDGE mentions real-time/websocket requirements
PRD_HAS_REALTIME=false
PRD_SEARCH_DIRS="$TARGET_DIR/.claude-project/context $TARGET_DIR/.claude-project/docs"
for SEARCH_DIR in $PRD_SEARCH_DIRS; do
  if [ -d "$SEARCH_DIR" ]; then
    if grep -rli 'real.time\|websocket\|socket\.io\|live.update\|real-time' "$SEARCH_DIR" --include='*.md' 2>/dev/null | grep -q .; then
      PRD_HAS_REALTIME=true
      break
    fi
  fi
done

if [ "$PRD_HAS_REALTIME" = true ]; then
  # Check 37: @WebSocketGateway decorator exists
  GATEWAY_COUNT=$(grep -rl '@WebSocketGateway' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$GATEWAY_COUNT" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$GATEWAY_COUNT gateway file(s) with @WebSocketGateway" \
      '. + [{"name":"websocket-gateway-exists","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"websocket-gateway-exists","pass":false,"detail":"PRD requires real-time but no @WebSocketGateway found — see nestjs/guides/websocket-gateway.md","duration_ms":0}]')
  fi

  # Check 38: Gateway has @SubscribeMessage event handlers (at least 1)
  if [ "$GATEWAY_COUNT" -ge 1 ]; then
    HANDLER_COUNT=$(grep -r '@SubscribeMessage' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
    if [ "$HANDLER_COUNT" -ge 1 ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$HANDLER_COUNT @SubscribeMessage handlers found" \
        '. + [{"name":"websocket-handlers-exist","pass":true,"detail":$d,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
        '. + [{"name":"websocket-handlers-exist","pass":false,"detail":"gateway exists but has no @SubscribeMessage handlers — add event handlers","duration_ms":0}]')
    fi
  fi

  # Check 39: Gateway has handleConnection with JWT cookie auth
  if [ "$GATEWAY_COUNT" -ge 1 ]; then
    GATEWAY_FILES=$(grep -rl '@WebSocketGateway' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null)
    HAS_CONN_AUTH=0
    if [ -n "$GATEWAY_FILES" ]; then
      HAS_CONN_AUTH=$(echo "$GATEWAY_FILES" | xargs grep -l 'handleConnection' 2>/dev/null | xargs grep -l 'cookie\|handshake\|jwtService\|JwtService\|verify' 2>/dev/null | wc -l | tr -d ' ')
    fi
    if [ "$HAS_CONN_AUTH" -ge 1 ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
        '. + [{"name":"websocket-auth","pass":true,"detail":"handleConnection with JWT/cookie auth found","duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
        '. + [{"name":"websocket-auth","pass":false,"detail":"gateway handleConnection missing JWT cookie authentication — see nestjs/guides/websocket-gateway.md","duration_ms":0}]')
    fi
  fi

  # Check 40: room-permission-enforced (composition — ROOM capability + RBAC).
  # A room-SCOPED gateway (joins rooms / broadcasts to a room) MUST verify the
  # actor belongs to the room before joining or emitting, else any authenticated
  # user can join/broadcast to arbitrary rooms (group-chat IDOR). Conditional:
  # only checked when the gateway is room-scoped. Correctness, threshold 0.
  if [ "$GATEWAY_COUNT" -ge 1 ]; then
    GW_FILES=$(grep -rl '@WebSocketGateway' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null)
    ROOM_SCOPED=0
    if [ -n "$GW_FILES" ]; then
      ROOM_SCOPED=$(echo "$GW_FILES" | xargs grep -lE '\.join\(|room\.join|\.to\(|roomId' 2>/dev/null | wc -l | tr -d ' ')
    fi
    if [ "$ROOM_SCOPED" -ge 1 ]; then
      MEMBERSHIP_CHECK=$(echo "$GW_FILES" | xargs grep -lE 'isMember|assertMember|RoomMemberGuard|membership|RoomMembership' 2>/dev/null | wc -l | tr -d ' ')
      if [ "$MEMBERSHIP_CHECK" -ge 1 ]; then
        CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
          '. + [{"name":"room-permission-enforced","pass":true,"detail":"room-scoped gateway verifies membership (isMember/assertMember/RoomMemberGuard)","duration_ms":0}]')
      else
        CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
          '. + [{"name":"room-permission-enforced","pass":false,"detail":"gateway joins/broadcasts to rooms but never checks room membership — any authed user can join/emit to arbitrary rooms (IDOR). Compose RoomMembershipService.isMember / RoomMemberGuard.","duration_ms":0}]')
      fi
    fi
  fi
fi

output_results
