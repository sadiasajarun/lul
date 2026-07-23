---
skill_name: learn-bugs
applies_to_local_project_only: false
auto_trigger_regex: [learn bugs, learn-bugs, bug learning, bug patterns]
tags: [qa, bug-patterns, knowledge, learning]
related_skills: [generate-prd, generate-user-stories-v2, deepen-user-stories, bug-feedback-loop]
description: Analyzes bug reports and accumulates them into a structured pattern knowledge base for PRD risk insertion and proactive user story generation.
allowed-tools: Agent, Read, Write, Edit, Glob, Grep, Bash(mkdir *), WebFetch
---

# Learn Bugs — Cumulative Bug Learning System

Analyzes bug reports and converts them into structured pattern knowledge, accumulating updates across repeated runs.

## Core Principles

1. **Cumulative Learning**: Each run adds to existing knowledge (never overwrites)
2. **Deduplication**: Identical patterns get frequency increments + new cases only
3. **Structured Format**: Strictly follows `skills/qa/learn-bugs/references/bug-pattern-schema.md`
4. **Immediate Utilization**: Automatically referenced by `/generate-prd` and `generate-user-stories-v2`

---

## Workflow

```
Phase 1: Parse Input Source
       ↓
Phase 2: Run bug-analyzer Agent
       ↓
Phase 3: Update Knowledge File
       ↓
Phase 4: Output Learning Report
```

---

## Phase 1: Parse Input Source

Parse input source from `$ARGUMENTS`.

### Input Type Detection

| Pattern | Type | Handling |
|---------|------|----------|
| `/path/to/file.md` | Single file | Read file directly |
| `/path/to/folder/` | Folder | Collect files via Glob `**/*.{md,csv,json,txt}` |

### --global Flag

- With `--global`: Save to global pattern file
  - Location: `skills/qa/learn-bugs/references/bug-patterns-global.yaml`
- Without (default): Save to project-specific pattern file
  - Location: `.claude-project/knowledge/bug-patterns.yaml`

### Validation

1. Verify file/folder exists
2. Verify supported format

**On validation failure:**
```
Error: [specific error message]
Usage: /learn-bugs /path/to/bug-reports/
Supported formats: .md, .csv, .json, .txt
```

---

## Phase 2: Run bug-analyzer Agent

Pass collected bug reports to the bug-analyzer agent.

### Agent Configuration

| Setting | Value |
|---------|-------|
| **Model** | sonnet |
| **Tools** | Read, Write, Glob, Grep, WebFetch |

### Agent Prompt

```
## Context
You are an agent that analyzes bug reports and converts them into structured pattern knowledge.

### Bug Report Content
{collected bug report content}

### Existing Pattern Knowledge (if any)
{existing bug-patterns content or "None (first learning run)"}

### Pattern Classification Schema
{bug-pattern-schema.md content — Read from skills/qa/learn-bugs/references/bug-pattern-schema.md}

## Goal
1. Classify and patternize each bug report
2. Check for duplicates against existing patterns
3. Duplicate patterns: increment frequency + add new cases only
4. New patterns: add as new entries
5. Output the complete updated bug-patterns

## Constraints
- Strictly follow bug-pattern-schema.md format
- Never delete existing pattern content (accumulate only)
- Every pattern must include a prevention spec
- Update metadata: Last updated, Total patterns, Sources
- **When --global flag is used: Abstract framework/library-specific content into generic expressions**
  - Remove ORM names: "Prisma `_count`" → "ORM computed field (`_count` or equivalent)"
  - Abstract library names: "react-i18next" → "i18n library", "NestJS" → "backend framework"
  - Filenames → screen types: "AdminDashboardPage.tsx" → "admin dashboard screen"
  - Apply same principle to prevention_spec: use pattern descriptions instead of specific API/class names

## Output Format
1. Complete updated bug-patterns content
2. Learning result summary (format below)

### Learning Results
- Bug reports analyzed: {N}
- New patterns added: {N}
- Existing pattern frequency updated: {N}
- Ignored (duplicate/irrelevant): {N}
- Newly added patterns: [{category: pattern_name}]
```

---

## Phase 3: Update Knowledge File

### Determine Save Location

```
Based on --global flag:

Global:
  → skills/qa/learn-bugs/references/bug-patterns-global.yaml

Project-specific:
  mkdir -p .claude-project/knowledge/
  → .claude-project/knowledge/bug-patterns.yaml
```

### Save File

Write the bug-analyzer output to the determined location using the Write tool.

---

## Phase 4: Output Learning Report

```markdown
## Bug Learning Complete

### This Run
- Input source: {source path}
- Bug reports analyzed: {N}
- New patterns added: {N}
- Existing pattern frequency updated: {N}
- Ignored (duplicate/irrelevant): {N}

### Cumulative Status
- Total patterns: {N} (across {M} categories)
- High-frequency patterns (5+): {N}
- Sources: {N} projects, {M} bug reports

### Newly Added Patterns
| # | Category | Pattern | Prevention Spec Summary |
|---|----------|---------|------------------------|

### Usage Guide
These patterns are automatically referenced by the following skills:
- `/generate-prd`: Inserted as ⚠️ Known Risk sections per screen
- `generate-user-stories-v2`: bug-pattern-writer generates Tier 14 preventive stories
- `deepen-user-stories`: Adds Tier 14 deep-dive stories in Phase 0.7
```

---

## Error Handling

| Situation | Response |
|-----------|----------|
| File not found | Error message + usage instructions |
| Empty file | Skip with warning message |
| Unparseable file | Skip with warning (continue processing remaining files) |
| Existing bug-patterns corrupted | Backup then create new |
