# Bug Learning Record: i18n False Positive Gate Pass

## Date: 2026-03-17
## Project: ReviewBoard
## Severity: High (PRD requirement 0% fulfilled despite gate passing)

## What Happened
PRD Section 4.7 requires react-i18next with 100% UI text coverage (EN/KO).
The frontend phase installed react-i18next but built a custom Zustand store instead.
Only ~18 nav keys were translated (~2% coverage).
The frontend gate passed because it only checks package.json presence.

## Root Cause Chain
1. Phase 6 instructions (06-frontend.md) don't mention i18n as a step
2. RULE-F1 exists but agent did easy parts only (install + toggle)
3. frontend-gate.sh Check 9 only verifies package.json, not initialization or usage
4. User story "Language toggle switches EN/KO" is too weak — passes with sidebar-only translation
5. No gate checks for: i18next.init() call, public/locales/ files, useTranslation() usage count

## Pattern: "Installed But Not Used"
Library presence in package.json ≠ library integrated into application.
Gates must check USAGE, not just INSTALLATION.

## Required Pipeline Fixes
1. frontend-gate.sh: Add 4-signal i18n check (package + init file + locale files + component usage)
2. 06-frontend.md: Add explicit Step 6.7 for i18n wiring
3. cross-page-flows.yaml: Strengthen language toggle story to check specific page content
4. Add new gate check: count files with useTranslation() vs total page files
