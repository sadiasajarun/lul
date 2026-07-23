# Feature Bundle Map

> When a feature is detected in client input, the corresponding bundle defines
> companion features that MUST be considered. Bundle items are **included by default**;
> PM may exclude items during Phase 4 confirmation.
>
> This file follows the same pattern as `admin-standards.md`:
> items are auto-applied unless the PM explicitly removes them.

---

## Tier System

| Tier | Marker | Default State | PM Action to Change |
|------|--------|---------------|---------------------|
| Required (필수) | `[필수]` | Always included | Must provide written reason to exclude |
| Recommended (권장) | `[권장]` | Included by default | Can exclude freely during Phase 4 |
| Conditional (조건부) | `[조건부: trigger]` | Included when trigger condition met | Same as Recommended |

### Marker Distinction

| Marker | Source | Meaning | Rule 6 (All-Decided) |
|--------|--------|---------|---------------------|
| `[권장]` | Bundle system | Bundle-derived Recommended item, included by default | NOT triggered — informational only |
| `[💡 Recommended: X]` | TBD system | Unclear/missing item needing PM decision | Triggered — must be resolved |
| `[📌 Adopted]` | PM confirmation | PM confirmed an item | Resolved |

These two recommendation markers serve different purposes and MUST NOT be confused:
- `[권장]` = "we included this because the bundle says it's standard. PM can remove if not needed."
- `[💡 Recommended: X]` = "this was unclear in client input. PM must decide before finalizing."

### Application Rules

1. **Required** items are woven into route specs silently — no marker needed
2. **Recommended** items are included with `[권장]` informational marker (not a TBD — does not trigger Rule 6)
3. **Conditional** items: parser evaluates trigger condition (Yes/No). If Yes, treated like Recommended
4. Items in MVP "Out of Scope" → bundle detected but marked **Deferred** (not written into PRD body)
5. Bundle items integrate naturally into existing sections (Section 0–4 + 2.5) — do NOT create a separate "Bundle" section

### Over-Specification Prevention

| Project Complexity | Screens | Max Active Bundles Before Warning |
|--------------------|---------|----------------------------------|
| Simple | < 10 | 3–4 |
| Medium | 10–25 | 5–7 |
| Complex | 25+ | 8–12 |

If detected bundles exceed the threshold, parser outputs:
```
⚠️ Bundle Density Warning: {N} bundles detected for a {complexity}-level project.
Review detected bundles and confirm all are MVP scope.
```

---

## Bundle 1: Auth/Registration (회원가입/인증)

**Trigger Keywords:** login, signup, registration, authentication, social login, OAuth, account, password, email verification, onboarding, 로그인, 회원가입, 소셜로그인, 인증

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| A1 | Login Page | 3 | Email/PW or Phone/PW input, validation rules, error states |
| A2 | Signup Page | 3 | Field collection form, terms agreement checkboxes |
| A3 | Forgot Password Flow | 2, 3 | Request reset → verify → set new password (3-step flow) |
| A4 | Logout | 3 | Logout action + session clear + redirect to login |
| A5 | Session Management | 2 | Token expiry, auto-logout, refresh token flow |
| A6 | Password Validation Rules | 0, 3 | Min length, complexity, error messages |
| A7 | Terms Agreement | 0, 3 | ToS / Privacy Policy / Marketing — separate checkboxes per legal requirement |
| A8 | User Status Lifecycle | 0 | Active, Suspended, Withdrawn — with exact behavior per status |
| A9 | Account Withdrawal Flow | 2, 3 | Soft delete, data retention notice, re-registration policy |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| A10 | Email Verification Flow | 2, 3 | Send code → verify → resend → expiry timer |
| A11 | Profile View/Edit Page | 3 | View my profile + edit fields + change password link |
| A12 | Auto-Login (Remember Me) | 3 | Token persistence, checkbox UI |
| A13 | Login Failure Handling | 3 | Attempt limit, lockout duration, CAPTCHA trigger threshold |
| A14 | Duplicate Account Check | 2 | Email/phone already registered → clear error message |
| A15 | Other User Profile Page | 3 | View another user's public profile (if multi-user interaction exists) |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| A16 | Social Login Buttons | Any OAuth provider mentioned | 3 | Google, Apple, Kakao, Naver button UI + callback handling |
| A17 | Apple Login | Any social login + iOS target | 3 | Mandatory per App Store policy when other social logins exist |
| A18 | Phone Verification (SMS OTP) | Phone as login ID or phone auth mentioned | 2, 3 | Send OTP → verify → resend → expiry |
| A19 | provider/providerId Fields | Any social login detected | 0 | System fields for OAuth identity (ties to QA Rule N2) |
| A20 | Two-Factor Authentication | 2FA/MFA mentioned or security-sensitive domain | 2, 3 | Setup flow, verification flow, recovery codes |

### Admin Impact

- User Management page (list, detail, status change, role assignment)
- Login history / session log
- Account suspension / ban controls
- Admin-initiated password reset

### Cross-Bundle Dependencies

- → Notification (welcome email, verification email, password reset email)
- → Invite/Share (if invite-based registration exists)

---

## Bundle 2: Chat/Messaging (채팅/메시징)

**Trigger Keywords:** chat, messaging, DM, direct message, conversation, real-time communication, in-app messaging, thread, 채팅, 메시지, 대화

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| C1 | Chat Room List Page | 3 | Conversations list, unread count badge, last message preview, timestamp |
| C2 | Chat Room Detail Page | 3 | Message list, input field, send button, scroll to bottom |
| C3 | Supported Message Types | 2 | Text at minimum — define all supported types |
| C4 | Message Ordering | 3 | Timestamp DESC, infinite scroll up for history |
| C5 | Unread Count | 2, 3 | Per-room badge + global navigation badge |
| C6 | Chat Room Creation Flow | 2, 3 | Select recipient → start conversation |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| C7 | Read Receipts | 2 | Message seen indicator (checkmark / timestamp) |
| C8 | Typing Indicator | 2 | Real-time "user is typing..." display |
| C9 | Message Timestamps | 3 | Relative time, date separators between days |
| C10 | Image/File Messages | 2, 3 | Image preview, file download, supported formats |
| C11 | Message Delete | 3 | Own messages only, "message deleted" placeholder |
| C12 | Chat Room Exit/Leave | 3 | Leave conversation + confirmation |
| C13 | New Message Push Notification | 2.5 | Push when app backgrounded, in-app banner when foregrounded |
| C14 | Empty State | 3 | No conversations yet — CTA to start chatting |
| C15 | Online/Offline Status | 3 | User online indicator (green dot) |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| C16 | Group Chat | "group chat" or "team chat" mentioned | 2, 3 | Create group, member management, group name/photo |
| C17 | Video/Voice Call Button | Video/voice call feature detected | 3 | Call button in chat room header |
| C18 | Message Reply/Thread | "reply" or "thread" mentioned | 3 | Quote original message, threaded view |
| C19 | Message Search | Search/Filter bundle also active | 3 | Search within conversation or across all chats |
| C20 | Block/Report User | Multi-user app with strangers | 2, 3 | Block from chat, report message, blocked user list |

### Admin Impact

- Chat monitoring / message moderation page
- Message log search (dispute resolution)
- User block/mute management
- Reported messages review queue

### Cross-Bundle Dependencies

- → Notification (new message push, in-app alert)
- → File Upload/Media (if image/file messages supported)
- → Real-time Adaptive Complexity Flag (WebSocket trigger for Phase B)

---

## Bundle 3: Payment/Subscription (결제/구독)

**Trigger Keywords:** payment, purchase, billing, subscription, plan, pricing, checkout, cart, order, refund, credit card, PG, Stripe, in-app purchase, fee, 결제, 구독, 환불, 주문

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| P1 | Payment/Checkout Flow | 2 | Select method → confirm → process → result (success/failure) |
| P2 | Payment Result Page | 3 | Success/failure states, order summary, next action CTA |
| P3 | Payment History Page | 3 | Past transactions list with date, amount, status, item |
| P4 | Refund Request Flow | 2, 3 | Reason selection → submit → processing status display |
| P5 | Payment Method Management | 3 | Add / remove / set default payment method |
| P6 | Price Display Standardization | 0 | Currency format, tax display rule, decimal handling |
| P7 | Payment Failure Handling | 2 | Retry logic, alternative method suggestion, timeout handling |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| P8 | Receipt/Invoice | 2, 3 | Downloadable PDF or email receipt |
| P9 | Payment Confirmation Notification | 2.5 | Email + push on successful payment |
| P10 | Coupon/Promo Code | 2, 3 | Apply code → discount calculation → validation |
| P11 | Tax Calculation Display | 3 | Tax amount breakdown before final confirmation |
| P12 | Refund Status Notification | 2.5 | Status update notifications (approved, processed, completed) |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| P13 | Subscription Plan Page | Multiple pricing tiers mentioned | 3 | Plan comparison, current plan, upgrade/downgrade |
| P14 | Auto-Renewal Management | Subscription model detected | 3 | Toggle auto-renewal, renewal date display |
| P15 | Free Trial Flow | "trial" or "free tier" mentioned | 2, 3 | Trial period, conversion prompt, trial expiry handling |
| P16 | Cart/Multi-Item Checkout | E-commerce or marketplace detected | 3 | Add to cart, cart page, quantity adjustment |
| P17 | Seller Payout/Settlement | Marketplace with multiple sellers | 2, 3 | Settlement cycle, payout history, commission rate |
| P18 | In-App Purchase (iOS/Android) | Native app with digital goods | 2 | IAP integration, restore purchases, sandbox testing |

### Admin Impact

- Transaction management page (list, detail, refund processing)
- Revenue dashboard (total, trends, plan distribution)
- Subscription management (user plans, manual adjustments)
- Coupon/promo management (create, deactivate, usage stats)
- Settlement/payout management (if marketplace)

### Cross-Bundle Dependencies

- → Notification (payment success/failure, subscription expiry, renewal reminder)
- → Billing Adaptive Complexity Flag (Phase B trigger)
- → Dashboard/Analytics (revenue metrics)

---

## Bundle 4: Booking/Scheduling (예약/스케줄링)

**Trigger Keywords:** booking, reservation, appointment, scheduling, calendar, time slot, availability, session, event registration, 예약, 일정, 스케줄, 캘린더

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| B1 | Available Slot Display | 3 | Calendar view or list view of available times |
| B2 | Booking Creation Flow | 2 | Select date/time → confirm details → submit |
| B3 | Booking Confirmation Page | 3 | Summary: date, time, provider, location/link |
| B4 | Booking Detail Page | 3 | Status, date/time, participants, actions |
| B5 | Booking Cancellation Flow | 2, 3 | Cancellation policy display → reason → confirm |
| B6 | My Bookings List | 3 | Upcoming + past tabs, sorted by date |
| B7 | Booking Status Lifecycle | 0, 1 | Pending → Confirmed → Completed / Cancelled / No-show |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| B8 | Reminder Notification | 2.5 | Configurable time before event (24h, 1h, 15m) |
| B9 | Reschedule Flow | 2, 3 | Change date/time without cancelling |
| B10 | Provider Availability Management | 3 | Set available hours, block specific dates |
| B11 | Double-Booking Prevention | 2 | Conflict check before confirming |
| B12 | Cancellation Policy Display | 3 | Free cancellation window, late cancellation fee |
| B13 | Timezone Handling | 0 | Display in user's local time, store in UTC |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| B14 | Recurring Booking | "recurring" or "weekly" sessions mentioned | 2, 3 | Repeat settings, series management |
| B15 | Waitlist | "waitlist" or limited capacity mentioned | 2, 3 | Join waitlist → auto-book on cancel |
| B16 | Payment at Booking | Payment bundle also active | 2 | Pay during booking flow, prepaid vs. pay-later |
| B17 | Video Call Link | Online/virtual session mentioned | 3 | Auto-generate meeting link on confirmation |
| B18 | Multi-Participant | Group events or attendee limits | 3 | Attendee count, capacity display, group booking |

### Admin Impact

- Booking management page (all bookings, filter by status/date/provider)
- Provider schedule management (availability calendar)
- Cancellation / no-show tracking
- Booking statistics (conversion rate, popular time slots)

### Cross-Bundle Dependencies

- → Notification (confirmation, reminder, cancellation notice)
- → Payment/Subscription (if paid bookings)
- → Dashboard/Analytics (booking metrics)

---

## Bundle 5: Assignment/Matching (할당/배정)

**Trigger Keywords:** assignment, matching, allocation, dispatch, pairing, task assignment, auto-matching, manual assignment, queue, 할당, 배정, 매칭

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| M1 | Assignment Request Flow | 2 | Who requests → what is requested → submission |
| M2 | Assignment Result Display | 3 | Who is assigned, contact info, status |
| M3 | Assignment Status Lifecycle | 0, 1 | Pending → Assigned → In Progress → Completed / Rejected |
| M4 | Assigned Item Detail Page | 3 | Assignment info, participant details, action buttons |
| M5 | My Assignments List | 3 | For both assigner and assignee roles |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| M6 | Accept/Reject by Assignee | 2, 3 | Assignee can accept or decline with reason |
| M7 | Reassignment Flow | 2 | Change assignee (by admin or original assigner) |
| M8 | Assignment History | 3 | Past assignments per user with outcomes |
| M9 | Deadline/Due Date | 3 | Due date display, overdue highlighting |
| M10 | Priority Levels | 0, 1 | Urgent / Normal / Low — visual indicators |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| M11 | Auto-Matching Engine | "automatic matching" or "algorithm" mentioned | 2 | Matching criteria definition, transparency display |
| M12 | Manual Assignment UI | Admin/manager performs assignments | 3 | Select assignee from list, drag-drop or dropdown |
| M13 | Queue/Round-Robin | "fair distribution" or "round-robin" mentioned | 2 | Distribution rules, queue position display |
| M14 | Geo-Based Matching | Location/proximity as criteria | 2 | Distance calculation, radius setting |

### Admin Impact

- Assignment overview dashboard (pending, in-progress, completed counts)
- Manual assignment controls
- Matching rule configuration (if auto-matching)
- Assignment performance metrics (turnaround time, completion rate)

### Cross-Bundle Dependencies

- → Notification (new assignment alert, status change updates)
- → Dashboard/Analytics (assignment metrics)

---

## Bundle 6: Board/Feed (게시판/피드)

**Trigger Keywords:** board, feed, post, article, community, forum, timeline, bulletin, notice, content feed, blog, 게시판, 피드, 커뮤니티, 공지사항

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| F1 | Post List Page | 3 | Title, author, date, view count — Default sort: createdAt DESC |
| F2 | Post Detail Page | 3 | Full content, author info, created/updated dates |
| F3 | Post Create Page | 3 | Title, body editor, submit button |
| F4 | Post Edit Page | 3 | Pre-filled form, save changes, own posts only |
| F5 | Post Delete | 3 | Own posts, confirmation dialog, soft delete |
| F6 | Pagination | 3 | Infinite scroll or page numbers on list |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| F7 | Rich Text Editor | 3 | Bold, italic, headings, links, image embed |
| F8 | Image Attachment | 3 | Upload images in post body |
| F9 | Categories/Tags | 3 | Filter by category, tag display |
| F10 | View Count | 2 | Track and display view count per post |
| F11 | Author Profile Link | 3 | Click author name → navigate to profile |
| F12 | Pin/Sticky Post | 3 | Admin can pin important posts to top |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| F13 | Comment System | "comment" or "reply" or "discussion" mentioned | 2, 3 | Create, edit, delete comment — nested or flat |
| F14 | Like/Bookmark | "like" or "save" or "bookmark" mentioned | 3 | Toggle like, bookmark list page |
| F15 | Content Report/Moderation | User-generated content with public visibility | 2, 3 | Report button → reason → submit |
| F16 | Hashtag System | "hashtag" or "tag-based discovery" mentioned | 3 | Clickable hashtags → filtered post list |

### Admin Impact

- Post management page (all posts, bulk delete, content moderation)
- Category management (CRUD)
- Reported content review queue
- Notice/announcement management (pin, schedule)

### Cross-Bundle Dependencies

- → Notification (new post in followed category, comment on my post)
- → File Upload/Media (attachments)
- → Search/Filter (board search)

---

## Bundle 7: Search/Filter (검색/필터)

**Trigger Keywords:** search, filter, sort, keyword search, advanced search, browse, discovery, 검색, 필터, 정렬

> Note: This bundle is cross-cutting. It enhances other bundles rather than standing alone.
> Activate only when search is a **primary feature** (dedicated search page or prominent search UX),
> not when basic list filtering is just part of another bundle.

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| S1 | Search Input Field | 3 | Placeholder text indicating searchable fields |
| S2 | Search Results Display | 3 | List format with relevant data per result |
| S3 | Search Empty State | 3 | "No results found" + suggestions or reset link |
| S4 | Filter Controls | 3 | At least one dimension: category, status, or date |
| S5 | Clear/Reset Filters | 3 | Reset all button, individual filter clear |
| S6 | Result Count Display | 3 | "N results found" text |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| S7 | Recent Search History | 3 | Persisted per user, clearable |
| S8 | Search Autocomplete | 3 | Suggestions as user types |
| S9 | Multi-Filter Combination | 3 | AND logic between filter categories |
| S10 | Sort Options | 3 | Relevance, date, name, popularity |
| S11 | Filter State Persistence | 2 | Maintained during navigation, cleared on explicit reset |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| S12 | Full-Text Search | Large content volume or "fuzzy search" mentioned | 2 | Elasticsearch/Algolia integration |
| S13 | Map-Based Results | Location data exists + "map view" mentioned | 3 | Map pin results, list/map toggle |
| S14 | Saved Search/Alert | "saved filters" or "notification on new matches" | 3 | Save filter set, alert on new matches |
| S15 | Advanced Filter Modal | 4+ filterable dimensions | 3 | Multi-criteria form in modal/drawer |

### Admin Impact

- Search analytics (popular queries, zero-result queries)
- Filter configuration management (if dynamic filters)

### Cross-Bundle Dependencies

- Enhances: Board/Feed, Booking, Review/Rating, any content list

---

## Bundle 8: File Upload/Media (파일 업로드/미디어)

**Trigger Keywords:** file upload, image upload, photo, attachment, media, document upload, profile picture, gallery, video upload, 파일, 업로드, 사진, 미디어

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| U1 | Upload UI Component | 3 | File selector button, drag-and-drop area (web) |
| U2 | File Type Restriction | 0, 3 | Allowed MIME types, displayed to user before upload |
| U3 | File Size Limit | 0, 3 | Max size per file, error message when exceeded |
| U4 | Upload Progress Indicator | 3 | Progress bar or percentage display |
| U5 | Upload Success/Failure Feedback | 3 | Toast notification or inline message |
| U6 | File Preview | 3 | Image thumbnail, document icon by type |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| U7 | Multi-File Upload | 3 | Batch selection, individual remove before submit |
| U8 | Image Compression | 2 | Client-side compression before upload |
| U9 | File Delete | 3 | Remove uploaded file with confirmation |
| U10 | Download Functionality | 3 | Download button for uploaded files |
| U11 | Upload Retry | 3 | Retry button on failure |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| U12 | Video Upload + Transcoding | "video" content mentioned | 2 | Upload flow, transcoding status, player |
| U13 | Document Viewer | "document preview" or "PDF viewer" mentioned | 3 | In-browser PDF/DOCX preview |
| U14 | Gallery/Media Library | Multiple media items per entity | 3 | Grid view, lightbox, reorder |
| U15 | Image Crop/Resize | Profile photo or specific dimensions needed | 3 | Crop tool before upload |

### Admin Impact

- Storage usage monitoring
- File moderation (reported/flagged files)
- Bulk file management

### Cross-Bundle Dependencies

- → File Upload Adaptive Complexity Flag (Phase B trigger)
- Enhances: Board/Feed, Chat, Review/Rating, Auth (profile photo)

---

## Bundle 9: Notification (알림)

**Trigger Keywords:** notification, alert, push, email notification, SMS, in-app notification, reminder, 알림, 푸시, 이메일 알림

> Note: This bundle is **implicitly activated** whenever any other bundle that produces
> user-facing events is active (Auth, Chat, Payment, Booking, Assignment, Board, Review, Invite).
> Only standalone activation requires explicit trigger keywords.

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| N1 | Notification List Page | 3 | All notifications, sorted by date DESC |
| N2 | Read/Unread Status | 3 | Visual distinction (bold/normal, dot indicator) |
| N3 | Mark as Read | 3 | Individual + "Mark all as read" action |
| N4 | Notification Badge | 3 | Unread count on navigation icon |
| N5 | Notification Tap Navigation | 2 | Deep link to relevant page on tap/click |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| N6 | Notification Settings Page | 3 | Per-category toggle on/off |
| N7 | Push Permission Request | 2, 3 | Timing (not on first launch), explanation text |
| N8 | Notification Grouping | 3 | Group by type or date |
| N9 | Notification Delete/Clear | 3 | Delete individual or clear all |
| N10 | Quiet Hours Setting | 3 | Do not disturb schedule (start/end time) |
| N11 | In-App Banner | 3 | Real-time toast when app is foregrounded |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| N12 | Email Notification Channel | "email notification" or "transactional email" mentioned | 2.5 | Email templates, delivery provider |
| N13 | SMS Notification Channel | "SMS" or "text alert" mentioned | 2.5 | SMS provider, rate limits, opt-out |
| N14 | Scheduled Notifications | Booking bundle active (reminders) | 2.5 | Delayed send, cron-based triggers |
| N15 | Rich Push (with image) | Native app + media content | 2.5 | Image in push notification |

### Admin Impact

- Notification template management (create, edit templates)
- Push notification broadcast (to all users or segments)
- Notification delivery logs (sent, delivered, opened rates)

### Cross-Bundle Dependencies

- ← Consumed by: every other bundle (each produces notification triggers)
- This is the most cross-cutting bundle

---

## Bundle 10: Review/Rating (리뷰/평점)

**Trigger Keywords:** review, rating, stars, feedback, testimonial, evaluation, score, 리뷰, 평점, 별점, 후기

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| R1 | Review Creation Form | 3 | Star rating (1–5) + text input |
| R2 | Review Display on Entity | 3 | Average rating, review list on target page |
| R3 | Review List Page | 3 | All reviews, sorted by createdAt DESC, with rating filter |
| R4 | Star Rating Component | 3 | 1–5 stars, tap/click to rate, visual states |
| R5 | Review Author Display | 3 | Author name, date, rating given |
| R6 | Own Review Edit/Delete | 3 | Edit text/rating, delete with confirmation |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| R7 | Review Photo Attachment | 3 | Upload images with review |
| R8 | Review Helpfulness Vote | 3 | "Was this helpful?" Yes/No |
| R9 | Rating Summary Statistics | 3 | Average score, distribution bar chart (5★: 40%, 4★: 30%...) |
| R10 | Review Sort Options | 3 | Most recent, highest rated, most helpful |
| R11 | One-Review Constraint | 2 | Prevent duplicate reviews per entity per user |
| R12 | Provider/Owner Response | 3 | Reply to review from service provider |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| R13 | Verified Badge | Payment or Booking bundle active | 3 | "Verified Purchase/Booking" badge on review |
| R14 | Review Moderation Queue | Public reviews with potential abuse | 2 | Auto-flag or manual review before publish |
| R15 | Review Request Prompt | Payment or Booking bundle triggers timed request | 2.5 | Prompt to leave review after transaction/booking completion |
| R16 | Multi-Criteria Rating | Multiple rating dimensions mentioned | 3 | Separate ratings per criterion (cleanliness, value, etc.) |

### Admin Impact

- Review management page (all reviews, filter by rating/status)
- Review moderation (approve, reject, flag inappropriate)
- Review analytics (average over time, flagged percentage)
- Review response management (admin/provider replies)

### Cross-Bundle Dependencies

- → Notification (new review on my listing, review response)
- → File Upload/Media (photo reviews)
- → Payment or Booking (verified badge trigger)

---

## Bundle 11: Dashboard/Analytics (대시보드/통계)

**Trigger Keywords:** dashboard, analytics, statistics, metrics, charts, reports, KPI, data visualization, 대시보드, 통계, 분석, 리포트

> Note: This bundle is **implicitly activated** for admin users when any data-producing
> bundle is active. Admin dashboard home is near-universal. Only user-facing analytics
> (seller dashboard, creator stats) require explicit client mention.

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| D1 | Statistics Summary Cards | 4 | Key metrics with period-over-period comparison % |
| D2 | Period Filter | 4 | Today / 7 days / 30 days / Custom date range |
| D3 | Chart Visualization | 4 | At least one chart (line for trends or bar for comparison) |
| D4 | Recent Activity List | 4 | Latest items/events with timestamp |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| D5 | Multiple Chart Types | 4 | Line (trends), bar (comparison), pie (distribution) |
| D6 | Data Export | 4 | CSV/Excel download of dashboard data |
| D7 | Metric Comparison | 4 | vs previous period, percentage change indicator |
| D8 | Key Metric Definitions | 4 | Tooltip or info icon explaining each metric |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| D9 | Revenue Metrics | Payment/Subscription bundle active | 4 | Total revenue, MRR, plan distribution |
| D10 | Booking Metrics | Booking bundle active | 4 | Utilization rate, popular slots, conversion rate |
| D11 | User Engagement Metrics | B2C app or "engagement" mentioned | 4 | DAU/MAU, retention, session duration |
| D12 | Content Metrics | Board/Feed bundle active | 4 | Posts, comments, likes per period |
| D13 | User-Facing Analytics | "seller dashboard" or "creator stats" mentioned | 3 | User's own statistics page (not admin) |

### Admin Impact

- This bundle IS primarily an admin feature (admin home page)
- All Required items apply to Section 4 admin dashboard

### Cross-Bundle Dependencies

- ← Consumes data from: every other active bundle
- This is a data consumer, not producer

---

## Bundle 12: Invite/Share (초대/공유)

**Trigger Keywords:** invite, referral, share, invitation code, invite link, share link, team invite, social sharing, 초대, 공유, 추천, 레퍼럴

### Required (필수)

| # | Item | Section | Description |
|---|------|---------|-------------|
| I1 | Share/Invite Action | 3 | Button or menu item on shareable entity |
| I2 | Share Link Generation | 2 | Unique URL per share instance |
| I3 | Share Channel Selection | 3 | Copy link, native share sheet (mobile), specific platform buttons |
| I4 | Invite Status Tracking | 3 | Sent, accepted, expired — list view |

### Recommended (권장)

| # | Item | Section | Description |
|---|------|---------|-------------|
| I5 | Invite via Email | 3 | Input email address, send invitation |
| I6 | My Invites List Page | 3 | Pending, accepted, expired invites |
| I7 | Referral Code System | 2, 3 | Unique code per user, share display |
| I8 | Deep Link Handling | 2 | Invited user lands on correct page after signup |
| I9 | Invite Expiration | 2 | Time-limited invites, expiry display |

### Conditional (조건부)

| # | Item | Condition | Section | Description |
|---|------|-----------|---------|-------------|
| I10 | Referral Reward | "referral bonus" or "credit" or "reward" mentioned | 2, 3 | Reward definition, tracking, limit |
| I11 | Team/Org Invite Flow | Multi-user org or workspace structure | 2, 3 | Invite to team, role assignment at invite |
| I12 | Social Platform Buttons | Specific platforms mentioned (KakaoTalk, etc.) | 3 | Platform-specific share buttons |
| I13 | Bulk Invite (CSV) | B2B or enterprise context | 3 | Upload CSV of email addresses |
| I14 | Role-Based Invite | Multiple user roles + inviter can specify role | 3 | Role selection at invite |

### Admin Impact

- Invite analytics (total sent, conversion rate)
- Referral program management (rewards, limits)
- Invite code management (generate, deactivate)

### Cross-Bundle Dependencies

- → Auth/Registration (invited user signup flow)
- → Notification (invite sent, invite accepted notifications)
- → Payment/Subscription (referral rewards if applicable)

---

## Quick Reference: Bundle Detection Summary

| # | Bundle | Implicit Activation | Primary Trigger |
|---|--------|--------------------|-----------------|
| 1 | Auth/Registration | — | login, signup, authentication |
| 2 | Chat/Messaging | — | chat, messaging, DM |
| 3 | Payment/Subscription | — | payment, billing, subscription |
| 4 | Booking/Scheduling | — | booking, reservation, calendar |
| 5 | Assignment/Matching | — | assignment, matching, dispatch |
| 6 | Board/Feed | — | board, post, community, feed |
| 7 | Search/Filter | — | search, filter (as primary feature only) |
| 8 | File Upload/Media | — | file upload, image, media |
| 9 | Notification | When any event-producing bundle is active | notification, push, alert |
| 10 | Review/Rating | — | review, rating, stars |
| 11 | Dashboard/Analytics | When admin user exists + any data bundle active | dashboard, analytics, statistics |
| 12 | Invite/Share | — | invite, referral, share |
