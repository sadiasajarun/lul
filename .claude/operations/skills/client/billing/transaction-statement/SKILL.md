---
name: generate-statement
description: "Generate a Transaction Statement (거래명세서) as HTML/PDF with Potential Inc branding. Invoke when user needs to create a formal Korean transaction statement."
argument-hint: "[--client 'company'] [--contact 'name'] [--brn 'XXX-XX-XXXXX'] [--poc 'name/phone'] [--date 'YYYY-MM-DD'] [--no-vat]"
---

# Generate Transaction Statement

Generate a branded Transaction Statement (거래명세서) document in HTML and PDF format with Potential Inc branding and standard Korean layout.

All arguments are optional. If any required information is missing, collect it interactively via AskUserQuestion.

---

## Usage

```bash
# Fully specified
/generate-statement --client "오누이" --contact "노대원 CRO님" --brn "123-45-67890"

# Minimal (will ask for everything)
/generate-statement

# No VAT for international clients
/generate-statement --client "Global Corp" --contact "John Smith CEO" --no-vat
```

---

## Workflow Overview

```
┌──────────────────────┐
│  Step 1               │
│  Parse & Collect Info  │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│  Step 2               │
│  Collect Line Items   │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│  Step 3               │
│  Generate HTML        │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│  Step 4               │
│  Convert to PDF       │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│  Step 5               │
│  Save to Records      │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│  Step 6               │
│  Report Result        │
└──────────────────────┘
```

---

## Step 1: Parse Arguments & Collect Missing Info

### 1.1 Parse Arguments

Extract from `$ARGUMENTS`:
- **--client**: Buyer company name (상호)
- **--contact**: Buyer representative / contact person (대표자/담당자)
- **--brn**: Buyer business registration number (사업자등록번호, format: XXX-XX-XXXXX)
- **--no-vat**: Exclude VAT (for international clients)
- **--poc**: Potential contact person name and phone (담당자, e.g., "오재열/010-5890-2440")
- **--date**: Transaction date (거래일자, format: YYYY-MM-DD, default: today)

### 1.2 Supplier Info (Hardcoded Defaults)

The supplier (공급자) section is always pre-filled with Potential Inc information:

| Field | Value |
|-------|-------|
| 사업자등록번호 | 491-81-02498 |
| 상호 | Potential Inc |
| 성명(대표자) | 신동섭 |
| 사업장 주소 | 경기도 안산시 상록구 안산천서로6길 30, 1층 사무실(월피동) |
| 업태 | 정보통신업, 소매업, 전문·과학 및 기술서비스업 |
| 종목 | 응용 소프트웨어 개발 및 공급업, 전자상거래 소매업, 시각 디자인업 |
| 입금계좌 | KB국민은행 270101-04-405201 |
| 예금주 | (주)포텐셜 |

### 1.3 Collect Buyer Info

> **CRITICAL**: If ANY of the following fields are missing from arguments, you MUST ask the user using AskUserQuestion. Do NOT skip required fields. Do NOT proceed to Step 2 until required fields are collected.

**Required fields:**

1. **Buyer company name** (`--client`)
   - Ask: "What is the buyer company name? (공급받는자 상호)"

2. **Buyer representative** (`--contact`)
   - Ask: "Who is the buyer representative? (대표자/담당자명, e.g., 홍길동 대표님)"

**Optional fields (ask in one multi-question prompt):**

3. **Business registration number** (`--brn`)
   - Ask: "Buyer's business registration number? (사업자등록번호, format: XXX-XX-XXXXX, leave blank if unknown)"

4. **Business address**
   - Ask: "Buyer's business address? (사업장 주소, leave blank if unknown)"

5. **Business type (업태)**
   - Ask: "Buyer's business type? (업태, leave blank if unknown)"

6. **Business category (종목)**
   - Ask: "Buyer's business category? (종목, leave blank if unknown)"

7. **Potential contact person** (`--poc`)
   - Ask: "Potential 담당자 이름과 연락처? (e.g., 오재열 / 010-5890-2440)"
   - This is the Potential Inc staff member responsible for this transaction

8. **Transaction date** (`--date`)
   - Ask: "Transaction date? (거래일자, e.g., 2026-03-23, default: today)"
   - Default to today's date if not provided. Use this date for the document number, header date, and signature date.

You may ask multiple questions at once using AskUserQuestion's multi-question support to minimize back-and-forth.

---

## Step 2: Collect Line Items

Use AskUserQuestion to collect the statement item details.

### 2.1 Select Statement Type

Ask the user:
```
What type of transaction statement is this?
```

Options:
- **Monthly Subscription (월 결제 구독)**: Monthly developer resource subscription model
- **Project-Based (프로젝트 단위)**: Fixed-price project-based statement
- **Custom (직접 입력)**: Enter items manually in free-form

### 2.2 If Monthly Subscription Selected

Ask the user for the following (can combine into one multi-question prompt):

1. **Developer composition**: "What developers are included? (e.g., Backend developer 20hrs/week, Frontend developer 20hrs/week)"
2. **Monthly amount**: "What is the monthly subscription amount? (단위: 만원)"
3. **Contract start date**: "When does the contract start? (e.g., 11.18)"
4. **Billing date**: "What day of each month is the billing date? (e.g., 18일)"

Generate a single line item from this:
- 품목: 월 결제 구독
- 규격: Developer composition summary
- 수량: 1
- 단가: Monthly amount

### 2.3 If Project-Based Selected

Ask the user:

1. **Line items**: "Please list the items, one per line, in the format 'Item name: Amount (만원)'."
   ```
   Example:
   기획 및 설계: 200
   프론트엔드 개발: 500
   백엔드 개발: 400
   QA 및 테스트: 100
   ```

2. **Specification (규격)**: "What is the specification for this project? (규격, e.g., 모바일 웹뷰앱, 관리자 웹 대시보드)"
   - Applied to all line items as a shared specification

Each line becomes a row:
- 품목: Item name
- 규격: Specification from above (shared across items)
- 수량: 1
- 단가: Amount in 만원

### 2.4 If Custom Selected

Ask the user to provide items in free-form text. Parse the response to extract:
- 품목 (Item name)
- 규격 (Specification, optional)
- 수량 (Quantity, default: 1)
- 단가 (Unit price in 만원)

---

## Step 3: Generate HTML

### 3.1 Generate Document Number

Format: `YYYYMMDD-N` (based on today's date)

**Shares the same sequence with generate-invoice.** Read `.claude-project/billing/invoice-records.json` to determine the next available number. See Step 5.3 for auto-increment logic.

### 3.2 Calculate Amounts

For each item:
- **공급가액** (Supply Amount) = 수량 × 단가 (in 만원)
- **세액** (Tax) = 공급가액 × 10% (omit if `--no-vat`)

Summary:
- **공급가액 합계** (Supply Total) = Sum of all item supply amounts
- **세액 합계** (Tax Total) = Sum of all item taxes
- **합계금액** (Grand Total) = 공급가액 합계 + 세액 합계

### 3.2.1 Amount Display Rules

> **CRITICAL**: Users provide amounts in 만원 (10,000 KRW) units for convenience. On the statement, you MUST convert and display the full amount in 원 (KRW) with comma formatting.

| User Input | Statement Display |
|------------|-------------------|
| 33만원 | 330,000 |
| 320만원 | 3,200,000 |
| 1200만원 | 12,000,000 |

**Conversion**: Multiply 만원 value by 10,000, then format with commas.

**Currency suffix**: Use "원" where applicable.

### 3.2.2 Korean Amount Text (합계금액)

Convert the grand total to Korean number text for the 합계금액 row.

**Conversion rules:**
- Use Korean counting units: 일, 이, 삼, 사, 오, 육, 칠, 팔, 구
- Use place units: 십, 백, 천, 만, 억
- Append "원정" at the end
- Prefix with "금 "

**Examples:**
| Amount (원) | Korean Text |
|-------------|-------------|
| 3,630,000 | 금 삼백육십삼만원정 |
| 12,100,000 | 금 천이백십만원정 |
| 33,000,000 | 금 삼천삼백만원정 |
| 5,500,000 | 금 오백오십만원정 |

### 3.3 Output Location

**Directory**: `.claude-project/billing/transaction-statement/`
**Filename**: `[Statement] {ClientName}.html`

Create directory if it doesn't exist.

### 3.4 HTML Template

> **IMPORTANT**: Replace all `[PLACEHOLDER]` values with actual data when generating the HTML file.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[Statement] [BUYER_NAME]</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        @page {
            size: A4;
            margin: 0;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
            color: #333;
            background: #fff;
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            position: relative;
        }

        .page {
            width: 100%;
            min-height: 297mm;
            padding: 40px 50px 0 50px;
            position: relative;
            display: flex;
            flex-direction: column;
        }

        /* Header */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 30px;
        }

        .header-logo svg {
            width: 180px;
            height: auto;
        }

        .header-right {
            text-align: right;
        }

        .header-right .doc-title {
            font-size: 32px;
            font-weight: 800;
            color: #050042;
            letter-spacing: 4px;
        }

        .header-right .doc-no {
            font-size: 13px;
            color: #666;
            margin-top: 4px;
        }

        .header-right .doc-no span {
            color: #333;
            font-weight: 500;
        }

        .header-right .doc-date {
            font-size: 13px;
            color: #666;
            margin-top: 2px;
        }

        .header-right .doc-date span {
            color: #333;
            font-weight: 500;
        }

        /* Info Grid Table */
        .info-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 12px;
        }

        .info-table th,
        .info-table td {
            border: 1px solid #333;
            padding: 6px 10px;
            vertical-align: middle;
        }

        .info-table .section-header {
            background: #624DFF;
            color: white;
            font-weight: 700;
            font-size: 13px;
            text-align: center;
            letter-spacing: 2px;
            width: 50%;
        }

        .info-table .field-label {
            background: #f8f7ff;
            color: #050042;
            font-weight: 600;
            text-align: center;
            width: 13%;
            white-space: nowrap;
        }

        .info-table .field-value {
            color: #333;
            font-weight: 400;
            width: 37%;
        }

        /* Total Amount Row */
        .total-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 13px;
        }

        .total-table th,
        .total-table td {
            border: 1px solid #333;
            padding: 8px 12px;
            vertical-align: middle;
        }

        .total-table .total-label {
            background: #624DFF;
            color: white;
            font-weight: 700;
            text-align: center;
            width: 12%;
            font-size: 13px;
            letter-spacing: 1px;
        }

        .total-table .total-korean {
            font-weight: 700;
            color: #050042;
            font-size: 14px;
            text-align: center;
        }

        .total-table .total-sub-label {
            background: #f8f7ff;
            color: #050042;
            font-weight: 600;
            text-align: center;
            width: 8%;
            white-space: nowrap;
        }

        .total-table .total-sub-value {
            text-align: right;
            font-weight: 600;
            white-space: nowrap;
            color: #333;
            width: 15%;
        }

        /* Items Table */
        .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 12px;
        }

        .items-table th {
            background: #624DFF;
            color: white;
            font-weight: 700;
            padding: 8px 6px;
            border: 1px solid #333;
            text-align: center;
            font-size: 12px;
            letter-spacing: 1px;
        }

        .items-table td {
            border: 1px solid #333;
            padding: 6px 8px;
            vertical-align: middle;
        }

        .items-table .col-no { width: 5%; text-align: center; }
        .items-table .col-item { width: 25%; }
        .items-table .col-spec { width: 12%; text-align: center; }
        .items-table .col-qty { width: 8%; text-align: center; }
        .items-table .col-unit { width: 13%; text-align: right; white-space: nowrap; }
        .items-table .col-supply { width: 15%; text-align: right; white-space: nowrap; }
        .items-table .col-tax { width: 12%; text-align: right; white-space: nowrap; }
        .items-table .col-remark { width: 10%; text-align: center; }

        .items-table .total-row td {
            background: #f8f7ff;
            font-weight: 700;
            color: #050042;
        }

        .items-table .empty-row td {
            height: 28px;
        }

        /* Signature */
        .signature-section {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-top: auto;
            padding-bottom: 30px;
        }

        .signature-left {
            text-align: center;
        }

        .signature-seal {
            width: 80px;
            height: 80px;
            margin-bottom: 10px;
            opacity: 0.7;
        }

        .signature-line {
            width: 200px;
            border-top: 1px solid #333;
            padding-top: 8px;
            font-size: 13px;
            color: #666;
        }

        .signature-right {
            text-align: center;
        }

        .signature-date {
            font-size: 16px;
            font-weight: 500;
            color: #333;
            margin-bottom: 10px;
        }

        .date-line {
            width: 200px;
            border-top: 1px solid #333;
            padding-top: 8px;
            font-size: 13px;
            color: #666;
        }

        /* Bank Info */
        .bank-info {
            font-size: 12px;
            color: #333;
            margin-bottom: 10px;
            line-height: 1.8;
        }

        .bank-info .label {
            color: #050042;
            font-weight: 600;
        }

        /* Contact Info */
        .contact-info {
            font-size: 12px;
            color: #666;
            margin-bottom: 20px;
        }

        .contact-info .label {
            color: #050042;
            font-weight: 600;
        }

        /* Bottom Bar */
        .bottom-bar {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 30px;
            display: flex;
        }

        .bottom-bar-left {
            flex: 1;
            background: #624DFF;
        }

        .bottom-bar-right {
            flex: 1;
            background: #4834CC;
        }

        @media print {
            body {
                width: 210mm;
                min-height: 297mm;
            }
            .page {
                min-height: 297mm;
            }
        }
    </style>
</head>
<body>
    <div class="page">
        <!-- Header -->
        <div class="header">
            <div class="header-logo">
                <!-- LOGO_SVG -->
            </div>
            <div class="header-right">
                <div class="doc-title">거래명세서</div>
                <div class="doc-no">No : <span>[DOC_NO]</span></div>
                <div class="doc-date">Date : <span>[DATE_FORMATTED]</span></div>
            </div>
        </div>

        <!-- Supplier / Buyer Info Grid -->
        <table class="info-table">
            <tr>
                <th class="section-header" colspan="2">공급자</th>
                <th class="section-header" colspan="2">공급받는자</th>
            </tr>
            <tr>
                <td class="field-label">등록번호</td>
                <td class="field-value">[SUPPLIER_BRN]</td>
                <td class="field-label">등록번호</td>
                <td class="field-value">[BUYER_BRN]</td>
            </tr>
            <tr>
                <td class="field-label">상호</td>
                <td class="field-value">[SUPPLIER_NAME]</td>
                <td class="field-label">상호</td>
                <td class="field-value">[BUYER_NAME]</td>
            </tr>
            <tr>
                <td class="field-label">대표자</td>
                <td class="field-value">[SUPPLIER_REP]</td>
                <td class="field-label">대표자</td>
                <td class="field-value">[BUYER_REP]</td>
            </tr>
            <tr>
                <td class="field-label">주소</td>
                <td class="field-value">[SUPPLIER_ADDR]</td>
                <td class="field-label">주소</td>
                <td class="field-value">[BUYER_ADDR]</td>
            </tr>
            <tr>
                <td class="field-label">업태</td>
                <td class="field-value">[SUPPLIER_TYPE]</td>
                <td class="field-label">업태</td>
                <td class="field-value">[BUYER_TYPE]</td>
            </tr>
            <tr>
                <td class="field-label">종목</td>
                <td class="field-value">[SUPPLIER_CAT]</td>
                <td class="field-label">종목</td>
                <td class="field-value">[BUYER_CAT]</td>
            </tr>
        </table>

        <!-- Total Amount Row -->
        <table class="total-table">
            <tr>
                <td class="total-label">합계금액</td>
                <td class="total-korean">[TOTAL_KOREAN_TEXT]</td>
                <td class="total-sub-label">공급가액</td>
                <td class="total-sub-value">[SUPPLY_TOTAL]원</td>
                <td class="total-sub-label">세액</td>
                <td class="total-sub-value">[TAX_TOTAL]원</td>
            </tr>
        </table>

        <!-- Items Table -->
        <table class="items-table">
            <thead>
                <tr>
                    <th class="col-no">No</th>
                    <th class="col-item">품목</th>
                    <th class="col-spec">규격</th>
                    <th class="col-qty">수량</th>
                    <th class="col-unit">단가</th>
                    <th class="col-supply">공급가액</th>
                    <th class="col-tax">세액</th>
                    <th class="col-remark">비고</th>
                </tr>
            </thead>
            <tbody>
                [ITEM_ROWS]
                [EMPTY_ROWS]
                <tr class="total-row">
                    <td colspan="4" style="text-align:center; letter-spacing:2px;">합 계</td>
                    <td></td>
                    <td class="col-supply">[SUPPLY_TOTAL]원</td>
                    <td class="col-tax">[TAX_TOTAL]원</td>
                    <td></td>
                </tr>
            </tbody>
        </table>

        <!-- Bank Info -->
        <div class="bank-info">
            <span class="label">입금계좌</span>&nbsp;&nbsp;KB국민은행 270101-04-405201 &nbsp;|&nbsp; 예금주: (주)포텐셜
        </div>

        <!-- Contact Info -->
        <div class="contact-info">
            <span class="label">담당자</span>&nbsp;&nbsp;[CONTACT_NAME] &nbsp;|&nbsp; [CONTACT_PHONE]
        </div>

        <!-- Signature -->
        <div class="signature-section">
            <div class="signature-left">
                <img class="signature-seal" src="data:image/png;base64,[SEAL_BASE64]" alt="seal">
                <div class="signature-line">공급자 (인)</div>
            </div>
            <div class="signature-right">
                <div class="signature-date">[DATE_FORMATTED]</div>
                <div class="date-line">Date</div>
            </div>
        </div>

        <!-- Bottom Bar -->
        <div class="bottom-bar">
            <div class="bottom-bar-left"></div>
            <div class="bottom-bar-right"></div>
        </div>
    </div>
</body>
</html>
```

### 3.5 Variable Substitution

| Variable | Value | Example |
|----------|-------|---------|
| `[DOC_NO]` | `YYYYMMDD-N` | `20260331-1` |
| `[DATE_FORMATTED]` | `YYYY. MM. DD` | `2026. 03. 31` |
| `[SUPPLIER_BRN]` | `491-81-02498` | (hardcoded) |
| `[SUPPLIER_NAME]` | `Potential Inc` | (hardcoded) |
| `[SUPPLIER_REP]` | `신동섭` | (hardcoded) |
| `[SUPPLIER_ADDR]` | Full address | (hardcoded) |
| `[SUPPLIER_TYPE]` | `정보통신업, 소매업, 전문·과학 및 기술서비스업` | (hardcoded) |
| `[SUPPLIER_CAT]` | `응용 소프트웨어 개발 및 공급업, 전자상거래 소매업, 시각 디자인업` | (hardcoded) |
| `[BUYER_BRN]` | Buyer BRN | `123-45-67890` |
| `[BUYER_NAME]` | Buyer company | `오누이` |
| `[BUYER_REP]` | Buyer representative | `노대원 CRO님` |
| `[BUYER_ADDR]` | Buyer address | (collected or blank) |
| `[BUYER_TYPE]` | Buyer business type | (collected or blank) |
| `[BUYER_CAT]` | Buyer business category | (collected or blank) |
| `[TOTAL_KOREAN_TEXT]` | Korean amount text | `금 삼백육십삼만원정` |
| `[SUPPLY_TOTAL]` | Supply total, comma-formatted | `3,300,000` |
| `[TAX_TOTAL]` | Tax total, comma-formatted | `330,000` |
| `[ITEM_ROWS]` | Item row HTML blocks | See 3.6 |
| `[EMPTY_ROWS]` | Empty padding rows | See 3.7 |
| `LOGO_SVG` | Contents of `templates/logo.svg` | SVG markup |
| `[SEAL_BASE64]` | Seal image as Base64 | See 3.9 |
| `[CONTACT_NAME]` | Potential contact person name | `오재열` |
| `[CONTACT_PHONE]` | Potential contact person phone | `010-5890-2440` |

### 3.6 Item Row HTML Structure

```html
<tr>
    <td class="col-no">[ROW_NUMBER]</td>
    <td class="col-item">[ITEM_NAME]</td>
    <td class="col-spec">[SPEC]</td>
    <td class="col-qty">[QUANTITY]</td>
    <td class="col-unit">[UNIT_PRICE]원</td>
    <td class="col-supply">[SUPPLY_AMOUNT]원</td>
    <td class="col-tax">[TAX_AMOUNT]원</td>
    <td class="col-remark">[REMARKS]</td>
</tr>
```

When `--no-vat` is specified, the tax column displays `0` for each row.

### 3.7 Empty Padding Rows

To maintain consistent table height, add empty rows after the last item row so the total item + empty rows equals at least 10.

```html
<tr class="empty-row">
    <td class="col-no"></td>
    <td class="col-item"></td>
    <td class="col-spec"></td>
    <td class="col-qty"></td>
    <td class="col-unit"></td>
    <td class="col-supply"></td>
    <td class="col-tax"></td>
    <td class="col-remark"></td>
</tr>
```

### 3.8 Logo SVG

Template files are located relative to the skill directory: `~/.claude/skills/generate-statement/templates/`

Read `templates/logo.svg` and insert its contents at the `<!-- LOGO_SVG -->` position.
- If the logo file is not found, use a text-based SVG fallback: `<svg width="180" height="40" viewBox="0 0 180 40" xmlns="http://www.w3.org/2000/svg"><text x="0" y="30" font-family="Inter, sans-serif" font-size="28" font-weight="800" fill="#050042">Potential</text></svg>`

### 3.9 Seal Image

**Path**: `~/.claude/skills/generate-statement/templates/seal.png`

Read `templates/seal.png`, Base64-encode it, and use as `data:image/png;base64,{encoded}` for the seal `<img>` src.

If the seal file is not found, omit the seal image from the statement.

---

## Step 4: Convert to PDF

### 4.1 Chrome Headless Command

Detect the platform and use the appropriate Chrome path:

**macOS:**
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless \
  --disable-gpu \
  --print-to-pdf="[OUTPUT_PDF_PATH]" \
  --no-margins \
  "file://[ABSOLUTE_HTML_PATH]"
```

**Windows:**
```bash
"C:/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless \
  --disable-gpu \
  --print-to-pdf="[OUTPUT_PDF_PATH]" \
  --no-margins \
  "file://[ABSOLUTE_HTML_PATH]"
```

### 4.2 Output File

**PDF filename**: `[Statement] {ClientName}.pdf`
**Location**: `.claude-project/billing/transaction-statement/` directory

### 4.3 Error Handling

If PDF conversion fails:
```
Error: PDF conversion failed.
Please verify that Google Chrome is installed.
The HTML file has been saved at: [HTML_PATH]
```

---

## Step 5: Save to Records

After generating the HTML and PDF, save the metadata to `.claude-project/billing/invoice-records.json`.

### 5.1 Record File

**Path**: `.claude-project/billing/invoice-records.json`

This file is a JSON array shared with generate-invoice. If the file does not exist, create it with an empty array `[]`.

### 5.2 Record Schema

Append the following object to the JSON array:

```json
{
  "documentType": "거래명세서",
  "invoiceNo": "YYYYMMDD-N",
  "client": "Buyer company name",
  "contact": "Buyer representative",
  "buyerBrn": "XXX-XX-XXXXX",
  "type": "Statement type (월결제/프로젝트/etc.)",
  "items": [
    {
      "title": "Item name",
      "spec": "Specification",
      "quantity": 1,
      "unitPrice": 200,
      "amount": 200,
      "tax": 20
    }
  ],
  "supplyTotal": 1100,
  "vat": 110,
  "total": 1210,
  "vatIncluded": true,
  "date": "YYYY-MM-DD",
  "files": {
    "html": ".claude-project/billing/transaction-statement/[Statement] ClientName.html",
    "pdf": ".claude-project/billing/transaction-statement/[Statement] ClientName.pdf"
  }
}
```

> **Note**: Amounts in the record are stored in 만원 units (matching generate-invoice convention).

### 5.3 Document Number Auto-Increment

The document number sequence is shared with generate-invoice records:

1. Read `.claude-project/billing/invoice-records.json`
2. Find ALL records (both 견적서 and 거래명세서) with today's date prefix (e.g., `20260331-`)
3. Set the sequence number to max existing + 1
4. If no records exist for today, start at `1`

Example: If `20260331-1` (견적서) and `20260331-2` (거래명세서) already exist, the next one is `20260331-3`.

### 5.4 How to Save

1. Read the existing `.claude-project/billing/invoice-records.json` file
2. Parse as JSON array
3. Append the new record object
4. Write the updated array back to the file (pretty-printed with 2-space indent)

---

## Step 6: Report Result

### Success Message

```
Transaction statement generated successfully.

HTML: .claude-project/billing/transaction-statement/[Statement] {ClientName}.html
PDF:  .claude-project/billing/transaction-statement/[Statement] {ClientName}.pdf

Buyer: [BUYER_NAME]
Representative: [BUYER_REP]
Supply Total: [SUPPLY_TOTAL]원
Tax: [TAX_TOTAL]원
Grand Total: [GRAND_TOTAL]원 ([TOTAL_KOREAN_TEXT])

You can preview the statement by opening the HTML file in a browser.
```

---

## Error Handling Summary

| Scenario | Action |
|----------|--------|
| Buyer company name missing | Ask via AskUserQuestion |
| Buyer representative missing | Ask via AskUserQuestion |
| Statement type not selected | Ask via AskUserQuestion |
| Line items missing | Ask via AskUserQuestion |
| Amount missing | Ask via AskUserQuestion |
| BRN not provided | Leave blank in document |
| Buyer address/type/category not provided | Leave blank in document |
| Logo file not found | Use built-in SVG fallback |
| Seal file not found | Omit seal image |
| PDF conversion fails | Report error, provide HTML file path |

---

## Examples

### Example 1: Project-Based Statement

```bash
/generate-statement --client "오누이" --contact "노대원 CRO님" --brn "123-45-67890"
```

-> Type: Project-Based
-> Items: 기획 200만원, Frontend 500만원, Backend 400만원, QA 100만원
-> Output: `.claude-project/billing/transaction-statement/[Statement] 오누이.pdf`

### Example 2: Monthly Subscription Statement

```bash
/generate-statement --client "테스트회사" --contact "홍길동 대표님"
```

-> Type: Monthly Subscription
-> Items: 월 결제 구독 320만원 (Backend 20h/wk + Frontend 20h/wk)
-> Output: `.claude-project/billing/transaction-statement/[Statement] 테스트회사.pdf`

### Example 3: No Arguments (Fully Interactive)

```bash
/generate-statement
```

-> Will ask for: buyer company, representative, BRN, address, type, category, statement type, all line items
-> All information collected via AskUserQuestion

### Example 4: International Client (No VAT)

```bash
/generate-statement --client "Global Corp" --contact "John Smith CEO" --no-vat
```

-> Tax column shows 0 for all items, tax total = 0
-> Output: `.claude-project/billing/transaction-statement/[Statement] Global Corp.pdf`

---

## Brand Guidelines Reference

| Element | Value |
|---------|-------|
| Primary Accent | `#624DFF` |
| Dark Accent | `#4834CC` |
| Headings | `#050042` |
| Body Text | `#333333` |
| Sub Text | `#666666` |
| Field Label BG | `#f8f7ff` |
| Background | `#ffffff` |
| Font | Inter (Google Fonts) |
| Logo | `templates/logo.svg` |
