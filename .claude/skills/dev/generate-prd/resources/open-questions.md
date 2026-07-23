# Open Questions Template

A living list of unresolved decisions, ambiguities, or client dependencies that need answers before or during development. Keeping these visible prevents assumptions from silently becoming bugs.

---

## How to Write This Section

- Add a row whenever a decision is unclear or depends on external input
- Include enough context that someone unfamiliar with the project understands why it matters
- Assign an owner and track resolution status
- Remove or archive questions once answered (or move the answer into the relevant PRD section)

---

## Template

```markdown
## Open Questions

| # | Question | Context / Impact | Owner | Status |
|:-:|----------|-----------------|-------|--------|
| 1 | [Question?] | [Why it matters — what gets blocked or breaks if unresolved] | [Client / PM / Tech Lead] | ⏳ Open |
| 2 | [Question?] | [Context] | [Owner] | ✅ Resolved: [answer] |
| 3 | [Question?] | [Context] | [Owner] | ⏳ Open |
```

---

## Status Legend

| Icon | Meaning |
|------|---------|
| ⏳ Open | No answer yet |
| ✅ Resolved | Answered — include the answer inline |
| 🔄 In Discussion | Being discussed, not yet decided |
| ⚠️ Blocked | Blocking development, urgent |

---

## Common Question Categories

Use these as prompts when reviewing the PRD for gaps:

**Product / UX**
- What happens when [edge case]?
- What should the empty state look like for [feature]?
- Is [feature] required for MVP or can it be deferred?
- What is the error message when [failure scenario]?

**Business / Policy**
- What is the data retention policy for [entity]?
- Can [user type] do [action]? Or is that restricted?
- What are the content moderation rules for [feature]?
- What triggers an email/push notification for [event]?

**Technical / Integration**
- What is the expected SLA / response time for [external service]?
- What is the fallback if [third-party API] is unavailable?
- Should [feature] handle [edge case] client-side or server-side?
- What happens when [AI/ML model] returns no match?

**Infrastructure**
- What are the storage cost limits for [file type]?
- Should [resource] be cached? For how long?
- What is the expected peak concurrent user count?

---

## Example

```markdown
## Open Questions

| # | Question | Context / Impact | Owner | Status |
|:-:|----------|-----------------|-------|--------|
| 1 | What is the AI recognition response time SLA? | Determines loading UX and timeout thresholds in the app | Client | ⏳ Open |
| 2 | What happens when the AI service returns multiple matches? | Current spec returns 1 result — need to handle multi-match UI | Tech Lead | 🔄 In Discussion |
| 3 | What is the data retention period after account withdrawal? | Required for privacy policy and storage cleanup job | PM | ⏳ Open |
| 4 | Should exhibitions be claimable by gallery owners in v2? | Affects data model design now — easier to plan ahead | Client | ✅ Resolved: Yes, planned for Phase 2 |
```

---

**Related:** [prd-template.md](prd-template.md)
