# Bolta Tax Invoice API — Field Reference

Complete field reference for all tax invoice operations. Pulled from https://docs.bolta.io/openapi.yaml.

---

## Common headers (all operations)

| Header | Required | Format | Notes |
|--------|----------|--------|-------|
| `Authorization` | yes | `Basic {Base64(API_KEY:)}` | Trailing colon is part of the encoded string |
| `Customer-Key` | yes | `customer_xxxxx` | Supplier identifier |
| `Bolta-Client-Reference-Id` | recommended | UUID | Idempotency key — retries with the same ID return the same result |
| `Content-Type` | yes | `application/json` | |

Base URL: `https://xapi.bolta.io/v1/`

---

## Forward issuance — `POST /v1/taxInvoices/issue`

### Root object

| Field | Type | Required | Constraint | Description (KR) |
|-------|------|----------|-----------|------------------|
| `date` | string (YYYY-MM-DD) | yes | | 작성일자 |
| `purpose` | enum | yes | `RECEIPT` \| `CLAIM` | 영수 / 청구 구분 |
| `supplier` | object | yes | | 공급자 정보 |
| `supplied` | object | yes | | 공급받는자 정보 |
| `items` | array | yes | 1–5 items | 품목 목록 |
| `description` | string | no | 1–200 chars | 세금계산서 비고 |

### `supplier` object

| Field | Type | Required | Constraint | Description |
|-------|------|----------|-----------|-------------|
| `identificationNumber` | string | yes | 10 digits, no hyphens | 사업자등록번호 |
| `taxRegistrationId` | string | no | 4 digits | 종사업장번호 |
| `organizationName` | string | yes | | 상호명 |
| `representativeName` | string | yes | | 대표자명 |
| `address` | string | no | | 주소 |
| `businessType` | string | no | | 업태 |
| `businessItem` | string | no | | 종목 |
| `manager` | object | yes | | Primary contact — `{ email, name?, phone?, mobile? }` |

### `supplied` object

Same as `supplier` **except**:

| Field | Difference |
|-------|-----------|
| `managers` | **Array** of 1–2 contacts (not a single `manager` object). First entry is the primary recipient; second is optional CC. |

Each manager entry: `{ email (required), name?, phone?, mobile? }`.

### `items[]` object

| Field | Type | Required | Constraint | Description |
|-------|------|----------|-----------|-------------|
| `date` | string (YYYY-MM-DD) | yes | | 공급일자 |
| `name` | string | yes | 1–80 chars | 품목명 |
| `supplyCost` | integer | yes | ≥ 1 (forward); any for amendments | 공급가액 |
| `tax` | integer \| null | no | `null` for tax-exempt | 세액 |
| `unitPrice` | integer | no | | 단가 |
| `quantity` | number | no | | 수량 |
| `specification` | string | no | | 규격 |
| `description` | string | no | | 품목 비고 |

---

## Reverse issuance — `POST /v1/taxInvoices/issueRequest`

Identical schema to forward issuance. Semantics: recipient initiates, supplier approves later. Returned `issuanceKey` represents the request; final NTS submission happens after supplier approval in the Bolta dashboard.

---

## Amendment — contract termination

**`POST /v1/taxInvoices/{issuanceKey}/amend/termination`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string (YYYY-MM-DD) | yes | Contract termination date |

Cannot be used if original invoice has any `items[].supplyCost < 0`.

---

## Amendment — supply-cost change

**`POST /v1/taxInvoices/{issuanceKey}/amend/changeSupplyCost`**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string (YYYY-MM-DD) | yes | Change date |
| `items` | array | yes | 1–5 items, each with the full item schema above. `supplyCost` may be positive (add) or negative (reduce). |

---

## Response envelope

### Success — 200

```json
{ "issuanceKey": "8D529FAD3EBAE050B79CE943CCC7CEDE" }
```

### Error — 400 / 500

```json
{ "code": "error_type", "message": "human-readable description" }
```

Common 400 causes:
- Missing trailing colon in `Authorization` Base64
- `identificationNumber` wrong length or contains hyphens
- `items.length` > 5
- `purpose` not in enum
- Duplicate `Bolta-Client-Reference-Id` with a different body (idempotency violation)

Do not retry on 400 — the payload is malformed. 500 is safe to retry with the same reference ID.

---

## Purpose enum semantics

| Value | Korean | Meaning |
|-------|--------|---------|
| `RECEIPT` | 영수 | Payment already received when invoice issued |
| `CLAIM` | 청구 | Invoice issued to claim future payment |

---

## Tax-exempt (면세) handling

For tax-exempt suppliers or exempt items, issue an **electronic calculation statement (전자계산서)** by setting `items[].tax = null`. Do not set `tax = 0` — that implies taxable with zero tax, which is a different document type.
