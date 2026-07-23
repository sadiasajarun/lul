---
name: kb
description: "Manage the Potential Knowledge Base — ingest sources, compile wiki, query knowledge, and maintain indexes"
user-invocable: true
argument-hint: "<command> [project] [options]"
---

# KB — Knowledge Base Management

Manage the centralized knowledge repository following Karpathy's LLM knowledge base pattern. Ingest raw sources (Slack exports, standups, meetings), compile into wiki articles, query knowledge, and maintain indexes.

## Repository Structure

```
potential-knowledge/
├── raw/                          # Source material (never edit manually)
│   └── {project}/
│       ├── slack/                # Slack exports (.json)
│       ├── standups/             # Raw standup transcripts
│       └── meetings/             # Meeting notes
│
├── wiki/                         # Compiled knowledge (source of truth)
│   ├── _index/
│   │   ├── projects.md           # All projects index
│   │   ├── recent.md             # Last 7 days activity
│   │   └── decisions.md          # All ADRs
│   ├── projects/{project}/
│   │   ├── overview.md
│   │   ├── changelog.md
│   │   ├── decisions/
│   │   └── standups/
│   ├── concepts/                 # Cross-project patterns
│   └── team/                     # Team docs
│
├── output/                       # Query results, reports
└── templates/                    # Standard templates
```

## Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `ingest` | `/kb ingest <project> <type> <path>` | Ingest raw source into wiki |
| `standup` | `/kb standup <project>` | Log today's standup |
| `decision` | `/kb decision <project> "<title>"` | Record architecture decision |
| `ask` | `/kb ask "<question>"` | Query knowledge base |
| `compile` | `/kb compile <project> [weekly\|monthly]` | Generate summary from raw sources |
| `reindex` | `/kb reindex` | Rebuild all index files |
| `recent` | `/kb recent [days]` | Show recent activity |
| `search` | `/kb search "<query>"` | Search across all docs |

---

## Command: ingest

Ingest raw source material and compile into wiki articles.

### Usage

```
/kb ingest <project> <type> <source_path>
```

### Types

| Type | Source | Output |
|------|--------|--------|
| `slack` | Slack export JSON | Extracts decisions, blockers, key discussions → changelog + decisions |
| `standup` | Standup transcript | Formats into standard template → standups/YYYY-MM-DD.md |
| `meeting` | Meeting notes | Extracts action items, decisions → changelog + decisions |
| `doc` | Any markdown | Classifies and files appropriately |

### Process

1. **Read** source file from `<source_path>`
2. **Parse** content based on type:
   - Slack: Extract messages, identify decisions/blockers/discussions
   - Standup: Parse by person, extract yesterday/today/blockers
   - Meeting: Extract attendees, decisions, action items
3. **Classify** extracted items:
   - Decision → `wiki/projects/{project}/decisions/YYYY-MM-DD-{topic}.md`
   - Blocker → Add to `wiki/projects/{project}/changelog.md`
   - Daily update → `wiki/projects/{project}/standups/YYYY-MM-DD.md`
4. **Update indexes** after ingestion
5. **Move** source to `raw/{project}/{type}/` for archival

### Example

```
/kb ingest ktalk slack ./slack-export-2026-04-14.json
```

Output:
```
Ingested slack export for ktalk:
- 3 decisions extracted → decisions/
- 12 updates added to changelog.md
- 2 blockers flagged
- Indexes updated
```

---

## Command: standup

Log today's standup interactively or from input.

### Usage

```
/kb standup <project>
```

### Process

1. **Check** if today's standup exists (`wiki/projects/{project}/standups/YYYY-MM-DD.md`)
2. If exists, **append** new entries
3. If not, **create** from template
4. **Prompt** for each team member:
   - Yesterday's work
   - Today's plan
   - Blockers
5. **Generate** summary paragraph
6. **Update** `_index/recent.md`

### Non-Interactive Mode

```
/kb standup <project> --from <file>
```

Reads standup notes from file and formats.

---

## Command: decision

Record an architecture decision.

### Usage

```
/kb decision <project> "<decision_title>"
```

### Process

1. **Prompt** for:
   - Context: What problem are we solving?
   - Options considered (at least 2)
   - Decision: What did we choose?
   - Rationale: Why this option?
   - Consequences: Trade-offs, follow-up work
2. **Create** `wiki/projects/{project}/decisions/YYYY-MM-DD-{slug}.md`
3. **Update** `_index/decisions.md`

### Quick Mode

```
/kb decision <project> "<title>" --quick "<one-line decision>"
```

Creates minimal ADR with just title and decision, marked for expansion.

---

## Command: ask

Query the knowledge base using natural language.

### Usage

```
/kb ask "<question>"
```

### Process

1. **Parse** question to identify:
   - Target project(s) or "all"
   - Time range (if mentioned)
   - Topic/keywords
2. **Search** relevant files:
   - Read `_index/*.md` for overview
   - Scan matching project folders
   - Check changelogs, decisions, standups
3. **Synthesize** answer from found content
4. **Cite** sources with file paths

### Examples

```
/kb ask "What blockers did K Talk have last week?"
/kb ask "How does auth work in CoFoundry?"
/kb ask "What decisions were made about payments across all projects?"
/kb ask "Who worked on the notification system?"
```

### Output

Answer with citations:
```
Based on the knowledge base:

[Answer text...]

Sources:
- wiki/projects/ktalk/changelog.md (lines 45-52)
- wiki/projects/ktalk/decisions/2026-04-10-push-notifications.md
```

---

## Command: compile

Generate summaries from raw sources.

### Usage

```
/kb compile <project> [period]
```

### Periods

| Period | Description |
|--------|-------------|
| `daily` | Today's activity (default) |
| `weekly` | Last 7 days summary |
| `monthly` | Last 30 days summary |

### Process

1. **Gather** all raw sources for period:
   - `raw/{project}/slack/` exports
   - `raw/{project}/standups/` transcripts
   - `raw/{project}/meetings/` notes
   - Existing `wiki/{project}/standups/` entries
2. **Analyze** and extract:
   - Key accomplishments
   - Decisions made
   - Blockers encountered + resolutions
   - People involved
3. **Generate** summary document
4. **Save** to `output/YYYY-MM-DD-{project}-{period}.md`
5. **Optionally** file back into wiki changelog

### Example

```
/kb compile ktalk weekly
```

Output saved to `output/2026-04-14-ktalk-weekly.md`

---

## Command: reindex

Rebuild all index files from wiki content.

### Usage

```
/kb reindex
```

### Process

1. **Scan** all `wiki/projects/*/overview.md` → rebuild `_index/projects.md`
2. **Scan** all `wiki/projects/*/decisions/` → rebuild `_index/decisions.md`
3. **Scan** all `wiki/projects/*/changelog.md` + `standups/` (last 7 days) → rebuild `_index/recent.md`
4. **Verify** no broken wikilinks
5. **Report** changes made

### Output

```
Reindex complete:
- projects.md: 12 projects indexed
- decisions.md: 45 ADRs indexed
- recent.md: 23 activities (last 7 days)
- Broken links fixed: 2
```

---

## Command: recent

Show recent activity across the knowledge base.

### Usage

```
/kb recent [days]
```

Default: 7 days

### Output

```
Recent Activity (Last 7 Days)

## 2026-04-14 (Today)
- [ktalk] Standup logged (3 updates)
- [cofoundry] Decision: Switch to WebSocket for real-time

## 2026-04-13
- [ktalk] Payment integration merged
- [hireagent] Blocker: SDK documentation incomplete

...
```

---

## Command: search

Full-text search across all wiki documents.

### Usage

```
/kb search "<query>"
```

### Process

1. **Grep** all `.md` files in `wiki/` for query
2. **Rank** by relevance (title match > content match)
3. **Return** top 10 results with context snippets

### Output

```
Search results for "authentication":

1. wiki/projects/cofoundry/decisions/2026-04-01-jwt-auth.md
   "Switched to JWT tokens for stateless authentication..."

2. wiki/concepts/auth-patterns.md
   "Standard authentication patterns used across projects..."

3. wiki/projects/ktalk/api.md
   "Authentication flow: User submits credentials..."

(7 more results)
```

---

## Auto-Maintenance

The knowledge base should be maintained continuously:

### Daily (via standup)
- Log standup for active projects
- Update `_index/recent.md`

### Weekly
- Run `/kb compile <project> weekly` for active projects
- File weekly summaries into changelogs
- Run `/kb reindex` to ensure consistency

### On Slack Export
- Run `/kb ingest <project> slack <export>` to capture decisions

### On Architecture Decisions
- Always record via `/kb decision` immediately

---

## Frontmatter Requirements

All wiki articles must have YAML frontmatter:

```yaml
---
title: "Article Title"
project: ktalk           # if project-specific
updated: 2026-04-14      # last update date
tags: [auth, api]        # for searchability
---
```

---

## Templates

Templates in `templates/` folder:

| Template | Use Case |
|----------|----------|
| `project-overview.md` | New project setup |
| `decision-record.md` | Architecture decisions |
| `standup-log.md` | Daily standups |
| `changelog-entry.md` | What changed, when |
| `concept-article.md` | Cross-project knowledge |

Always use templates for consistency.

---

## Global Sync

After modifying this skill, sync to global:

```bash
cp -r skills/internal/kb ~/.claude/skills/kb
```

Reverse sync (global → operations):

```bash
cp -r ~/.claude/skills/kb skills/internal/kb
```
