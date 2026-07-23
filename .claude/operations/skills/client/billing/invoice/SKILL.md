---
name: generate-invoice
description: "Generate an Invoice (견적서) as HTML/PDF with Potential Inc branding. Invoke when user needs to create a client invoice."
argument-hint: "[--client 'company'] [--contact 'name'] [--no-vat]"
---

# Generate Invoice Command

Generate a branded Invoice (견적서) document in HTML and PDF format matching the Potential Inc invoice template.

All arguments are optional. If any required information is missing, collect it interactively via AskUserQuestion.

---

## Usage

```bash
# Fully specified
/generate-invoice --client "오누이" --contact "노대원 CRO님"

# Minimal (will ask for everything)
/generate-invoice

# No VAT for international clients
/generate-invoice --client "Global Corp" --contact "John Smith CEO" --no-vat
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
- **--client**: Client company name
- **--contact**: Contact person name + title
- **--no-vat**: Exclude VAT (for international clients)

### 1.2 Collect ALL Missing Required Fields

> **CRITICAL**: If ANY of the following fields are missing from arguments, you MUST ask the user using AskUserQuestion. Do NOT skip any field. Do NOT proceed to Step 2 until all fields are collected.

**Required fields to collect (if not provided):**

1. **Client company name** (`--client`)
   - Ask: "What is the client company name? (고객사명)"

2. **Contact person** (`--contact`)
   - Ask: "Who is the contact person and their title? (담당자명 + 직함, e.g., 노대원 CRO님)"

You may ask multiple questions at once using AskUserQuestion's multi-question support to minimize back-and-forth.

---

## Step 2: Collect Invoice Line Items

Use AskUserQuestion to collect the invoice item details.

### 2.1 Select Invoice Type

Ask the user:
```
What type of invoice is this?
```

Options:
- **Monthly Subscription (월 결제 구독)**: Monthly developer resource subscription model
- **Project-Based (프로젝트 단위)**: Fixed-price project-based invoice
- **Custom (직접 입력)**: Enter items manually in free-form

### 2.2 If Monthly Subscription Selected

Ask the user for the following (can combine into one multi-question prompt):

1. **Developer composition**: "What developers are included? (e.g., Backend developer 20hrs/week, Frontend developer 20hrs/week)"
2. **Monthly amount**: "What is the monthly subscription amount? (단위: 만원)"
3. **Contract start date**: "When does the contract start? (e.g., 11.18)"
4. **Billing date**: "What day of each month is the billing date? (e.g., 18일)"

### 2.3 If Project-Based Selected

Ask the user:

1. **Line items**: "Please list the invoice items, one per line, in the format 'Item name: Amount (만원)'."
   ```
   Example:
   기획 및 설계: 200
   프론트엔드 개발: 500
   백엔드 개발: 400
   QA 및 테스트: 100
   ```
2. **Additional details** (optional): "Any additional details for each item?"

### 2.4 If Custom Selected

Ask the user to provide items and amounts in free-form text. Parse the response to extract item names and amounts.

---

## Step 3: Generate HTML

> **SINGLE-PAGE CONSTRAINT**: The invoice MUST render on a single A4 page. The template is pre-tuned for up to ~10 line items. If the rendered PDF exceeds 1 page, shrink proportionally (padding, font sizes, margins) until it fits. See Step 4.4 for the verification loop.

### 3.1 Generate Invoice Number

Format: `YYYYMMDD-1` (based on today's date)

Example: `20260303-1`

### 3.2 Calculate Amounts

- **SUB TOTAL**: Sum of all item amounts
- **Vat Tax (10%)**: SUB TOTAL × 0.1 (omit if `--no-vat`)
- **TOTAL**: SUB TOTAL + Vat Tax (equals SUB TOTAL if `--no-vat`)

### 3.2.1 Amount Display Rules

> **CRITICAL**: Users provide amounts in 만원 (10,000 KRW) units for convenience. On the invoice, you MUST convert and display the full amount in 원 (KRW) with comma formatting.

| User Input | Invoice Display |
|------------|----------------|
| 33만원 | 330,000원 |
| 320만원 | 3,200,000원 |
| 3.3만원 (VAT) | 33,000원 |
| 1200만원 | 12,000,000원 |

**Conversion**: Multiply 만원 value by 10,000, then format with commas and append "원".

**Currency symbol**: Use "원" (not ₩ or KRW).

### 3.3 Output Location

**Directory**: `.claude-project/billing/invoice/`
**Filename**: `[Invoice] {ClientName}.html`

Create directory if it doesn't exist.

### 3.4 HTML Template

> **IMPORTANT**: Replace all `[PLACEHOLDER]` values with actual data when generating the HTML file.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[Invoice] [CLIENT_NAME]</title>
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
            height: 297mm;
            margin: 0 auto;
            position: relative;
        }

        /* Single-page A4: fixed height + overflow:hidden prevents page break */
        .page {
            width: 100%;
            height: 297mm;
            padding: 28px 50px 0 50px;
            position: relative;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Header */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 22px;
        }

        .header-logo svg {
            width: 170px;
            height: auto;
        }

        .header-right {
            text-align: right;
        }

        .header-right .invoice-title {
            font-size: 30px;
            font-weight: 800;
            color: #050042;
            letter-spacing: 2px;
        }

        .header-right .invoice-no {
            font-size: 13px;
            color: #666;
            margin-top: 4px;
        }

        .header-right .invoice-no span {
            color: #333;
            font-weight: 500;
        }

        /* Info Section */
        .info-section {
            display: flex;
            justify-content: space-between;
            margin-bottom: 22px;
        }

        .info-left {
            text-align: left;
        }

        .info-right {
            text-align: right;
        }

        .info-label {
            font-size: 11px;
            color: #999;
            font-weight: 600;
            letter-spacing: 1px;
            margin-bottom: 6px;
        }

        .info-client-name {
            font-size: 20px;
            font-weight: 700;
            color: #050042;
            margin-bottom: 3px;
        }

        .info-contact {
            font-size: 14px;
            color: #333;
            font-weight: 500;
        }

        .info-company-name {
            font-size: 17px;
            font-weight: 700;
            color: #050042;
            margin-bottom: 5px;
        }

        .info-company-detail {
            font-size: 12px;
            color: #666;
            line-height: 1.5;
        }

        /* Table */
        .invoice-table {
            width: 100%;
            margin-bottom: 16px;
        }

        .table-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #624DFF;
            color: white;
            padding: 11px 22px;
            border-radius: 8px 8px 0 0;
            font-weight: 700;
            font-size: 14px;
            letter-spacing: 1px;
        }

        .table-body {
            padding: 16px 22px;
            border: none;
        }

        .table-item {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 7px;
        }

        .item-title {
            font-size: 14px;
            font-weight: 600;
            color: #333;
        }

        .item-price {
            font-size: 14px;
            font-weight: 600;
            color: #333;
            white-space: nowrap;
        }

        .item-details {
            margin-left: 20px;
            margin-top: 3px;
            margin-bottom: 10px;
        }

        .item-detail {
            font-size: 13px;
            color: #555;
            line-height: 1.6;
            display: flex;
            align-items: center;
        }

        .item-detail::before {
            content: "-";
            margin-right: 6px;
            color: #999;
        }

        .sub-detail {
            margin-left: 20px;
        }

        /* Summary */
        .summary-divider {
            border: none;
            border-top: 1px solid #ddd;
            margin: 10px 0;
        }

        .summary-section {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            padding: 0 22px;
            margin-bottom: 14px;
        }

        .summary-row {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            margin-bottom: 6px;
            width: 300px;
        }

        .summary-label {
            font-size: 13px;
            color: #666;
            text-align: right;
            margin-right: 28px;
            flex: 1;
        }

        .summary-value {
            font-size: 15px;
            font-weight: 600;
            color: #333;
            text-align: right;
            min-width: 100px;
        }

        .summary-total .summary-label {
            font-size: 15px;
            font-weight: 700;
            color: #050042;
        }

        .summary-total .summary-value {
            font-size: 19px;
            font-weight: 800;
            color: #050042;
        }

        /* Signature */
        .signature-section {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-top: auto;
            /* MUST exceed .bottom-bar height (30px) so Signature/Date labels clear the bar */
            padding-bottom: 50px;
        }

        .signature-left {
            text-align: center;
        }

        .signature-seal {
            width: 64px;
            height: 64px;
            margin-bottom: 6px;
            opacity: 0.7;
        }

        .signature-line {
            width: 180px;
            border-top: 1px solid #333;
            padding-top: 6px;
            font-size: 12px;
            color: #666;
        }

        .signature-right {
            text-align: center;
        }

        .signature-date {
            font-size: 15px;
            font-weight: 500;
            color: #333;
            margin-bottom: 6px;
        }

        .date-line {
            width: 180px;
            border-top: 1px solid #333;
            padding-top: 6px;
            font-size: 12px;
            color: #666;
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
                height: 297mm;
            }
            .page {
                height: 297mm;
                overflow: hidden;
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
                <div class="invoice-title">견적서</div>
                <div class="invoice-no">Invoice No : <span>[INVOICE_NO]</span></div>
            </div>
        </div>

        <!-- Info Section -->
        <div class="info-section">
            <div class="info-left">
                <div class="info-label">INVOICE TO</div>
                <div class="info-client-name">[CLIENT_NAME]</div>
                <div class="info-contact">[CONTACT_NAME]</div>
            </div>
            <div class="info-right">
                <div class="info-label">COMPANY:</div>
                <div class="info-company-name">Potential Inc</div>
                <div class="info-company-detail">
                    131,Continental Dr<br>
                    Suite 305 Newark, Delaware<br>
                    United States
                </div>
            </div>
        </div>

        <!-- Invoice Table -->
        <div class="invoice-table">
            <div class="table-header">
                <span>TITLE</span>
                <span>PRICE</span>
            </div>
            <div class="table-body">
                [INVOICE_ITEMS]
            </div>
        </div>

        <!-- Summary -->
        <hr class="summary-divider">
        <div class="summary-section">
            <div class="summary-row">
                <span class="summary-label">SUB TOTAL</span>
                <span class="summary-value">[SUB_TOTAL]원</span>
            </div>
            [VAT_ROW]
            <div class="summary-row summary-total">
                <span class="summary-label">TOTAL</span>
                <span class="summary-value">[TOTAL]원</span>
            </div>
        </div>

        <!-- Signature -->
        <div class="signature-section">
            <div class="signature-left">
                <img class="signature-seal" src="data:image/svg+xml;base64,[SEAL_BASE64]" alt="seal">
                <div class="signature-line">Signature</div>
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
| `[CLIENT_NAME]` | Client company name | `오누이` |
| `[CONTACT_NAME]` | Contact person + title | `노대원 CRO님` |
| `[INVOICE_NO]` | `YYYYMMDD-1` | `20260303-1` |
| `[INVOICE_ITEMS]` | Item HTML blocks | See below |
| `[SUB_TOTAL]` | Sum of all items, comma-formatted | `330,000` |
| `[VAT_ROW]` | VAT row HTML (empty string if `--no-vat`) | See below |
| `[TOTAL]` | Final total, comma-formatted | `363,000` |
| `[DATE_FORMATTED]` | `YYYY. MM. DD` | `2026. 03. 03` |
| `[SEAL_BASE64]` | Seal image as Base64 | See 3.9 |
| `LOGO_SVG` | Contents of `templates/logo.svg` | SVG markup |

### 3.6 Item HTML Structure

**Monthly Subscription example:**
```html
<div class="table-item">
    <span class="item-title">세부내역</span>
</div>
<div style="display: flex; justify-content: space-between;">
    <div class="item-details">
        <div class="item-detail"><span>월 결제 구독</span></div>
        <div class="item-details" style="margin-left: 48px;">
            <div class="item-detail">백엔드 개발자 주 20시간</div>
            <div class="item-detail">프론트엔드 개발자 주 20시간</div>
        </div>
        <div class="item-detail"><span>계약 시작일 11.18</span></div>
        <div class="item-details" style="margin-left: 48px;">
            <div class="item-detail">매월 18일 결제</div>
        </div>
    </div>
    <div class="item-price" style="padding-top: 4px;">[PRICE]원</div>
</div>
```

**Project-Based example (multiple items):**
```html
<div class="table-item">
    <span class="item-title">[Item Name]</span>
    <span class="item-price">[Amount]원</span>
</div>
```

### 3.7 VAT Row HTML

When VAT is included (default):
```html
<div class="summary-row">
    <span class="summary-label">Vat Tax (10%)</span>
    <span class="summary-value">[VAT_AMOUNT]원</span>
</div>
```

When `--no-vat` is specified: empty string (VAT row omitted).

### 3.8 Logo SVG

Read `templates/logo.svg` and insert its contents at the `<!-- LOGO_SVG -->` position.
- If the logo file is not found, skip logo and render without branding.

### 3.9 Seal Image

**Path**: `templates/seal.png`

Read `templates/seal.png`, Base64-encode it, and use as `data:image/png;base64,{encoded}` for the seal `<img>` src.

If the seal file is not found, omit the seal image from the invoice.

---

## Step 4: Convert to PDF

### 4.1 Chrome Headless Command

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless \
  --disable-gpu \
  --print-to-pdf="[OUTPUT_PDF_PATH]" \
  --no-margins \
  "file://[ABSOLUTE_HTML_PATH]"
```

### 4.2 Output File

**PDF filename**: `[Invoice] {ClientName}.pdf`
**Location**: `.claude-project/billing/invoice/` directory

### 4.3 Error Handling

If PDF conversion fails:
```
Error: PDF conversion failed.
Please verify that Google Chrome is installed.
The HTML file has been saved at: [HTML_PATH]
```

### 4.4 Verify Single-Page Output (REQUIRED)

After PDF generation, verify the output is exactly **1 page**. Run:

```bash
python3 -c "from pypdf import PdfReader; print(len(PdfReader('[PDF_PATH]').pages))"
```

If the output is **> 1**:
1. Reduce layout density in this order until it fits:
   - `.page` padding-top: 28px → 20px → 16px
   - `.table-item` margin-bottom: 7px → 5px → 4px
   - `.info-section` / `.header` margin-bottom: 22px → 16px → 12px
   - Font sizes: scale all by 0.9x (e.g., 14 → 13, 15 → 14, 20 → 18)
2. Regenerate HTML + PDF, verify again.
3. Do NOT report success until page count == 1.

`.page { height: 297mm; overflow: hidden; }` already clips overflow, but clipped content is a bug — the content must genuinely fit, not be hidden.

---

## Step 5: Save to Invoice Records

After generating the HTML and PDF, save the invoice metadata to `.claude-project/billing/invoice-records.json`.

### 5.1 Record File

**Path**: `.claude-project/billing/invoice-records.json`

This file is a JSON array that stores all generated invoice records. If the file does not exist, create it with an empty array `[]`.

### 5.2 Record Schema

Append the following object to the JSON array:

```json
{
  "invoiceNo": "YYYYMMDD-N",
  "client": "Client company name",
  "contact": "Contact person name",
  "type": "Invoice type (월결제/프로젝트/유지보수/etc.)",
  "items": [
    {
      "title": "Item description",
      "amount": 33
    }
  ],
  "subTotal": 33,
  "vat": 3.3,
  "total": 36.3,
  "vatIncluded": true,
  "date": "YYYY-MM-DD",
  "files": {
    "html": ".claude-project/billing/invoice/[Invoice] ClientName.html",
    "pdf": ".claude-project/billing/invoice/[Invoice] ClientName.pdf"
  }
}
```

### 5.3 Invoice Number Auto-Increment

When generating the invoice number:
1. Read `.claude-project/billing/invoice-records.json`
2. Find all records with today's date prefix (e.g., `20260303-`)
3. Set the sequence number to max existing + 1
4. If no records exist for today, start at `1`

Example: If `20260303-1` and `20260303-2` already exist, the next one is `20260303-3`.

### 5.4 How to Save

1. Read the existing `.claude-project/billing/invoice-records.json` file
2. Parse as JSON array
3. Append the new record object
4. Write the updated array back to the file (pretty-printed with 2-space indent)

---

## Step 6: Report Result

### Success Message

```
Invoice generated successfully.

HTML: .claude-project/billing/invoice/[Invoice] {ClientName}.html
PDF:  .claude-project/billing/invoice/[Invoice] {ClientName}.pdf

Client: [CLIENT_NAME]
Contact: [CONTACT_NAME]
Total: [TOTAL]원 (VAT included/excluded)

You can preview the invoice by opening the HTML file in a browser.
```

---

## Error Handling Summary

| Scenario | Action |
|----------|--------|
| Client name missing | Ask via AskUserQuestion |
| Contact name missing | Ask via AskUserQuestion |
| Invoice type not selected | Ask via AskUserQuestion |
| Line items missing | Ask via AskUserQuestion |
| Amount missing | Ask via AskUserQuestion |
| Logo file not found | Use built-in SVG fallback |
| PDF conversion fails | Report error, provide HTML file path |
| PDF exceeds 1 page | Shrink per Step 4.4 and regenerate until page count == 1 |

---

## Examples

### Example 1: Monthly Subscription Invoice

```bash
/generate-invoice --client "오누이" --contact "노대원 CRO님"
```

→ Type: Monthly Subscription
→ Items: 월 결제 구독 320만원 (Backend 20h/wk + Frontend 20h/wk)
→ Output: `.claude-project/billing/invoice/[Invoice] 오누이.pdf`

### Example 2: Project-Based Invoice

```bash
/generate-invoice --client "테스트회사" --contact "홍길동 PM님"
```

→ Type: Project-Based
→ Items: 기획 200만원, Frontend 500만원, Backend 400만원
→ Output: `.claude-project/billing/invoice/[Invoice] 테스트회사.pdf`

### Example 3: No Arguments (Fully Interactive)

```bash
/generate-invoice
```

→ Will ask for: client name, contact person, invoice type, all line items, amounts
→ All information collected via AskUserQuestion

### Example 4: International Client (No VAT)

```bash
/generate-invoice --client "Global Corp" --contact "John Smith CEO" --no-vat
```

→ VAT row omitted, TOTAL = SUB TOTAL
→ Output: `.claude-project/billing/invoice/[Invoice] Global Corp.pdf`

---

## Brand Guidelines Reference

| Element | Value |
|---------|-------|
| Primary Accent | `#624DFF` |
| Dark Accent | `#4834CC` |
| Headings | `#050042` |
| Body Text | `#333333` |
| Sub Text | `#666666` |
| Background | `#ffffff` |
| Font | Inter (Google Fonts) |
| Logo | `templates/logo.svg` |
