---
name: tax-invoice
description: Issue Korean electronic tax invoices (세금계산서) through the Bolta API. Supports forward issuance (정발행), reverse issuance (역발행), and amendments (수정발행 — contract termination, supply-cost change). Use when the user asks to issue/send/cancel/amend a 세금계산서, integrate Bolta, or automate NTS (국세청) e-tax invoice submission.
argument-hint: [forward|reverse|amend-termination|amend-supply-cost] [--test|--live]
user-invocable: true
---

# Tax Invoice (세금계산서) Issuance via Bolta API

Automates Korean electronic tax invoice issuance through the Bolta REST API. The Bolta platform wraps NTS (국세청 홈택스) e-tax invoice submission behind a single idempotent HTTP endpoint per operation.

## When to use

Trigger this skill when the user asks for any of:

- "세금계산서 발행", "tax invoice issuance", "issue a Korean tax invoice"
- "역발행" (reverse — recipient-requested issuance)
- "수정발행" (amendment — contract termination, supply-cost change, etc.)
- Integrating Bolta API, automating NTS submission, or writing client code that calls `xapi.bolta.io`

Do **not** trigger for generic invoice (견적서) or transaction statement (거래명세서) generation — those are separate skills (`invoice/`, `transaction-statement/`).

---

## Prerequisites

Before the first call, the issuer must complete these one-time steps in the Bolta dashboard:

1. Create a workspace and generate an **API key** (Developer Center). Test keys start with `test_`; live keys start with `live_`.
2. Register a **digital certificate** for NTS submission (test certificate available in sandbox).
3. For live keys only: **fund points** (per-issuance fee).
4. Create a **customer** (supplier/issuer identity) via the customer API and record the returned `customerKey`.

Store keys as environment variables — never commit to source:

```
BOLTA_API_KEY=test_xxxxxxxxxxxx
BOLTA_CUSTOMER_KEY=customer_xxxxxxxx
```

### Teammate onboarding — env not set up yet

Credentials live in **1Password** (account `team-potentialai.1password.com`, vault `Shared`, item `Bolta API`). Scripts pull secrets via `op run` — nothing touches disk.

Direct the teammate to [.claude/operation/scripts/bolta/README.md](../../../scripts/bolta/README.md) and have them run:

```bash
brew install 1password-cli               # once per machine
# enable desktop app: Settings → Developer → Integrate with 1Password CLI
op signin

cd .claude/operation/scripts/bolta
npm install
npm run check                            # resolves secrets from 1Password
```

If `op` errors with "permission denied" on the vault, the teammate needs admin to grant access to the `Shared` 1Password vault.

Never ask the user to paste keys into chat. If 1Password access fails, fall back to the ops admin (신동섭 / `contact@potentialai.com`), not chat.

---

## Authentication

Every request requires three headers:

| Header | Value | Purpose |
|--------|-------|--------|
| `Authorization` | `Basic {Base64(API_KEY + ":")}` | API authentication. **Note the trailing colon before encoding.** |
| `Customer-Key` | `customer_xxxxx` | Identifies the supplier (invoice issuer) |
| `Bolta-Client-Reference-Id` | client-generated UUID | Idempotency key. Same ID = same result; prevents duplicate issuance |
| `Content-Type` | `application/json` | |

Base URL: `https://xapi.bolta.io/v1/`

Test keys (`test_` prefix) and live keys (`live_` prefix) use separate customer keys — they are **not interchangeable**. Always validate which environment the key targets before sending a request.

---

## Operations

| Operation | Endpoint | Method |
|-----------|----------|--------|
| Forward issuance (정발행) | `/v1/taxInvoices/issue` | POST |
| Reverse issuance (역발행) | `/v1/taxInvoices/issueRequest` | POST |
| Amendment — contract termination (계약의 해제) | `/v1/taxInvoices/{issuanceKey}/amend/termination` | POST |
| Amendment — supply cost change (공급가액 변동) | `/v1/taxInvoices/{issuanceKey}/amend/changeSupplyCost` | POST |

All successful responses return:

```json
{ "issuanceKey": "8D529FAD3EBAE050B79CE943CCC7CEDE" }
```

Persist the `issuanceKey` — it is the handle for amendments, status polling, and audit trails.

---

## Quick reference — Forward issuance (정발행)

**POST** `/v1/taxInvoices/issue`

Minimum required body (see [references/api-spec.md](references/api-spec.md) for the full schema):

```json
{
  "date": "2025-01-15",
  "purpose": "RECEIPT",
  "supplier": {
    "identificationNumber": "1234567890",
    "organizationName": "공급자 상호",
    "representativeName": "홍길동",
    "manager": { "email": "supplier@example.com" }
  },
  "supplied": {
    "identificationNumber": "0987654321",
    "organizationName": "공급받는자 상호",
    "representativeName": "김철수",
    "managers": [{ "email": "recipient@example.com" }]
  },
  "items": [{
    "date": "2025-01-15",
    "name": "테스트 품목",
    "unitPrice": 10000,
    "quantity": 1,
    "supplyCost": 10000,
    "tax": 1000
  }]
}
```

Field rules:
- `purpose`: `RECEIPT` (영수) or `CLAIM` (청구)
- `items`: 1–5 line items per invoice. Split into multiple invoices if more.
- `identificationNumber`: 10-digit 사업자등록번호, no hyphens.
- `tax`: omit or set to `null` for tax-exempt items (전자계산서, 면세 사업자).
- `supplier.manager` is a single object; `supplied.managers` is an array (1–2 contacts).

---

## Quick reference — Reverse issuance (역발행)

**POST** `/v1/taxInvoices/issueRequest`

Same schema as forward issuance. Use when the **recipient** initiates the request and the supplier approves later. The returned `issuanceKey` represents the request; final issuance happens after supplier approval.

---

## Quick reference — Amendments (수정발행)

**Always requires the original `issuanceKey`.** The amendment creates a new invoice that offsets or supersedes the original.

### Contract termination (계약의 해제)

**POST** `/v1/taxInvoices/{issuanceKey}/amend/termination`

```json
{ "date": "2025-01-20" }
```

Use when the transaction is fully reversed. Bolta offsets the original (상계처리). Cannot amend if the original has negative `supplyCost` items.

### Supply-cost change (공급가액 변동)

**POST** `/v1/taxInvoices/{issuanceKey}/amend/changeSupplyCost`

```json
{
  "date": "2025-01-20",
  "items": [
    { "date": "2025-01-20", "name": "상품명", "supplyCost": -500, "tax": -50 }
  ]
}
```

Use `supplyCost` = delta (positive to add, negative to reduce). Include matching `tax` delta for taxable items.

---

## Execution checklist

When writing integration code, walk through these in order:

1. **Detect the HTTP client already in the project** (see [references/http-client-detection.md](references/http-client-detection.md)) — do not install a new one if one exists.
2. **Load credentials from env vars** — never inline API keys. Read `BOLTA_API_KEY` and `BOLTA_CUSTOMER_KEY`.
3. **Encode `Authorization` correctly** — Base64 of `API_KEY:` (with trailing colon). Forgetting the colon is the single most common error.
4. **Generate a `Bolta-Client-Reference-Id`** per logical invoice — UUID v4 is fine. Persist it alongside the invoice record so retries are idempotent.
5. **Validate input before send**:
   - `identificationNumber` is exactly 10 digits, no hyphens.
   - `purpose` ∈ {`RECEIPT`, `CLAIM`}.
   - `items.length` between 1 and 5.
   - `supplied.managers` has at least one entry with a valid email.
6. **On 200**: persist `issuanceKey` and map it to the local invoice ID.
7. **On 4xx**: surface `body.code` and `body.message` to the user. Do **not** retry on 4xx — the request is malformed.
8. **On 5xx / network error**: retry with the same `Bolta-Client-Reference-Id` (idempotent — duplicate issuance is prevented server-side).
9. **Test vs live separation**: route requests through distinct credentials per environment and never mix them in a single deployment.

---

## Framework-agnostic implementation

This skill produces code in whatever language/framework the project already uses. Detect first, then generate. See [references/http-client-detection.md](references/http-client-detection.md) for the detection table (Node/axios, Python/httpx, Go/net-http, Java/OkHttp, etc.).

When detection fails, fall back to a bare `curl` example and ask the user which language they want the wrapper in.

---

## Templates

- [templates/forward-issue-request.json](templates/forward-issue-request.json) — full-featured forward issuance body
- [templates/reverse-issue-request.json](templates/reverse-issue-request.json) — reverse issuance body
- [templates/amend-termination-request.json](templates/amend-termination-request.json) — contract termination
- [templates/amend-supply-cost-request.json](templates/amend-supply-cost-request.json) — supply-cost delta

---

## References

- Full field reference: [references/api-spec.md](references/api-spec.md)
- HTTP client detection: [references/http-client-detection.md](references/http-client-detection.md)
- Bolta API docs: https://docs.bolta.io/docs/api-introduction/overview
- Authentication: https://docs.bolta.io/docs/api-introduction/authentication
- OpenAPI spec: https://docs.bolta.io/openapi.yaml
