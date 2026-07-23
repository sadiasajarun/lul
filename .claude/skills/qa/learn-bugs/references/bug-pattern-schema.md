# Bug Pattern Classification Schema

This file defines the structure and required fields for each pattern in `bug-patterns`.

---

## YAML Structure

```yaml
metadata:
  last_updated: "YYYY-MM-DD"
  total_patterns: N
  sources:
    projects: N
    bug_reports: N

categories:
  - id: "auth"
    name: "Authentication/Login"
    patterns:
      - id: "auth-001"
        name: "Pattern name"
        frequency: N
        severity: "high|medium|low"  # 5+: high, 3-4: medium, 1-2: low
        symptom: "Symptom experienced by the user"
        root_cause: "Technical cause"
        affected_screens: ["List of affected screens/features"]
        prevention_spec: "Specific spec statement to insert into PRD"
        code_signals: ["<form", "onSubmit"]  # Signals in code where this pattern may apply
        cases: ["ProjectName #IssueNumber"]
```

---

## Required Pattern Fields

| Field | Required | Description |
|-------|:--------:|-------------|
| **id** | ✅ | Unique identifier in category-number format (e.g., auth-001) |
| **name** | ✅ | Pattern name |
| **frequency** | ✅ | Number of times discovered |
| **severity** | ✅ | Grade (1-2 times: low, 3-4 times: medium, 5+ times: high) |
| **symptom** | ✅ | Problem from the user's perspective (minimize technical jargon) |
| **root_cause** | ✅ | Why it occurs (technical cause) |
| **affected_screens** | ✅ | Screen/feature types where this pattern may apply |
| **prevention_spec** | ✅ | Specific spec statement that can be directly inserted into PRD |
| **code_signals** | ✅ | Keywords/patterns for detecting applicability of this pattern in code |
| **cases** | ✅ | Source (project name + issue number or filename) |

---

## Category Classification

### Standard Categories

| Category ID | Category Name | Scope | code_signals |
|-------------|---------------|-------|-------------|
| `auth` | Authentication/Login | Login, signup, social login, tokens, sessions, passwords | `login`, `signup`, `auth`, `token`, `session` |
| `file_upload` | Image/File Upload | File size, format, upload failure, image resizing | `<input type="file"`, `FormData`, `upload`, `multer` |
| `list_pagination` | List/Pagination | Infinite scroll, page numbers, sorting, filtering, empty states | `pagination`, `page`, `limit`, `offset`, `infiniteScroll` |
| `push_notification` | Push Notifications | Notification delivery, permissions, deep links, foreground/background | `notification`, `FCM`, `APNs`, `push` |
| `payment` | Payment/In-App Purchase | Payment flow, refunds, receipts, concurrent payments | `payment`, `checkout`, `stripe`, `cart`, `invoice` |
| `realtime` | Real-time Data | Chat, WebSocket, real-time updates, synchronization | `WebSocket`, `socket.io`, `EventSource`, `useSubscription` |
| `admin_dashboard` | Admin Dashboard | Statistics, filters, export, bulk actions, permissions | `admin`, `dashboard`, `statistics`, `export` |
| `search_filter` | Search/Filter | Search results, filter combinations, autocomplete, recent searches | `search`, `filter`, `query`, `autocomplete` |
| `navigation` | Navigation/Routing | Deep links, back button, tab switching, history | `navigate`, `router`, `history`, `deeplink`, `useParams` |
| `data_sync` | Data Synchronization | Offline, conflict resolution, cache, optimistic updates | `useQuery`, `invalidate`, `cache`, `optimistic` |
| `form_input` | Form/Input | Validation, autosave, multi-step forms, file attachments | `<form`, `onSubmit`, `<input`, `validation`, `useForm` |
| `performance` | Performance | Slow loading, memory leaks, rendering delays | `useMemo`, `useCallback`, `lazy`, `Suspense` |
| `ui_layout` | UI/Layout | Responsive design, design system, profile images, icons | `className`, `style`, `responsive`, `Tailwind` |

### Category Extension Rules

- Bugs that don't fit standard categories → create new category
- Category names should be based on **functional area** (not tech stack)
- Example: "React Rendering" (❌) → "List/Pagination" (✅)

---

## Duplicate Detection Criteria

Criteria for determining if two bugs are the same pattern:

1. Belong to the **same category**, AND
2. Have an **identical or very similar root cause**, AND
3. The **prevention spec proposes the same solution**

→ If all 3 are met: **Duplicate** → increment frequency + add new cases only

→ If any differ: **New pattern** → add as new entry

---

## Prevention Spec Writing Rules

Prevention specs are directly inserted into PRDs, so they must follow these rules:

1. **Specific**: "Error handling needed" (❌) → "On network error, display 'Please check your connection' toast for 3 seconds + retry button" (✅)
2. **Actionable**: Detailed enough for a developer to implement immediately
3. **Client/Server distinction**: "[Client] File size validation (10MB) + [Server] double validation"
4. **Include user experience**: Technical handling + visible result for the user

---

## Metadata Update Rules

On each learning run:
- `last_updated`: Update to current date
- `total_patterns`: Recount total patterns
- `sources`: Add new sources (if duplicate source, increment count only)

---

## Frequency Grade Criteria

| Grade | Count | PRD Application Priority |
|-------|-------|--------------------------|
| **high** | 5+ times | Must apply |
| **medium** | 3-4 times | Recommended |
| **low** | 1-2 times | Optional |

In `/generate-prd`, **high/medium** patterns are applied first, and **low** patterns are applied only when relevant screens exist.
