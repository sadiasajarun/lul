# Admin Dashboard Standard Feature Matrix

> All Required (✅) items in this file are **auto-applied to every admin page**.
> Include even if the client doesn't mention them — no `[💡 Recommended]` marking needed.
> Only exclude when the client explicitly requests exclusion.

---

## Core Standard Features

### List Page Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Search** | Keyword search field (name, ID, email, etc.) | ✅ |
| **Filters** | Status / Date / Category dropdown filters | ✅ |
| **Column Sorting** | Click table header to sort ASC/DESC | ✅ |
| **Checkbox Selection** | Row checkboxes + Select All checkbox | ✅ |
| **Bulk Actions** | Bulk delete / Status change / Export for selected items | ✅ |
| **Pagination** | Page navigation + Items per page selector (10/25/50/100) | ✅ |

### Table UI Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Loading State** | Skeleton or spinner while data loads | ✅ |
| **Empty State** | Message displayed when no data exists | ✅ |
| **Error State** | "Failed to load data" message + Retry button on API error | ✅ |
| **Search No Results** | "No results found" message + Reset filters link when search returns 0 | ✅ |
| **Action Column** | Edit / Delete / View Detail buttons per row | ✅ |

### Detail/Edit Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Detail Drawer/Modal** | Click row to open detail panel | ✅ |
| **Edit Form** | Switch to edit mode within detail view | ✅ |
| **Delete Confirmation** | Confirmation dialog before deletion | ✅ |
| **Audit Log** | Track who/when/what was modified | Optional |

### Data Export Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **CSV/Excel Download** | Export current filtered/searched results | ✅ |
| **Date Range Selection** | Period filter for export | ✅ |

### Common UI/UX Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Toast Notifications** | Success/Error feedback messages | ✅ |
| **Breadcrumb** | Current location navigation | ✅ |
| **Create Modal/Drawer** | Form for adding new items | ✅ |

### Dashboard Home Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Statistics Cards** | Key metrics with period-over-period % comparison | ✅ |
| **Period Filter** | Today / Last 7 days / Last 30 days / Custom date range | ✅ |
| **Charts** | Trend visualization (line/bar charts) | ✅ |
| **Recent Activity** | Recently created/modified items list | ✅ |

---

## Extended Standards (v2)

| # | Feature | Description | Required |
|---|---------|-------------|:--------:|
| 1 | **Bulk Action Confirmation** | Confirmation dialog for bulk delete/change: "Delete N items?" | ✅ |
| 2 | **Soft Delete Default** | Deletion uses soft delete (is_deleted flag), recovery possible | ✅ |
| 3 | **Date/Time Format** | List: YYYY-MM-DD HH:mm with relative time (e.g., "3 hours ago"), timezone: server-based | ✅ |
| 4 | **RBAC** | Admin permission levels control menu/action visibility | Recommended |
| 5 | **Responsive** | Below 1024px: horizontal table scroll. Below 768px: card view | Recommended |
| 6 | **Concurrent Edit** | Optimistic lock on simultaneous edits + "Modified by another user" notification | Recommended |
| 7 | **Column Customization** | Per-user visible column selection and ordering | Optional |
| 8 | **Keyboard Shortcuts** | Esc: close modal, Enter: confirm, Arrow keys: table navigation | Optional |

---

## Agent Application Rules

1. All **✅ Required** items are auto-included in every admin page
2. **Recommended** items are included by default but can be excluded based on project characteristics
3. **Optional** items are included only on client request
4. No `[💡 Recommended]` marking needed (these are standards, not TBDs)
5. No need to explicitly list applied standard features per page (uniformly applied to all pages)
6. If any item is exceptionally excluded, state the reason

## Mandatory Components Per Admin Page

Each admin page MUST define:

1. **Top Area**: Search, Filters, Create button, Bulk Action dropdown
2. **Table Component**: Checkbox column + Data columns (with type, sortable) + Action column
3. **Creation Modal**: Validation rules table per input field
4. **Detail Drawer/Modal**: All display fields + available actions
5. **Delete Flow**: Confirmation dialog + Soft delete
6. **Export**: CSV/Excel download options
