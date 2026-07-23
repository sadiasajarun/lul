# Base Stack Rules (Framework-Agnostic)

## General Principles
- Specification-first: always verify against seed/PRD before building
- Design-then-build: complete visual design before writing code
- Incremental evaluation: check quality after every phase
- Deterministic + agentic: use shell scripts for verifiable checks, LLM for creative work

## Documentation
- Keep PROJECT_KNOWLEDGE.md as source of truth for features
- Keep PROJECT_API.md as source of truth for endpoints
- Keep PROJECT_DATABASE.md as source of truth for schema
- Update docs BEFORE implementation, not after

## Quality
- Every phase must pass its quality gate before proceeding
- Max 2 fix attempts per gate failure (diminishing returns)
- Track artifact hashes for invalidation detection
- Pipeline score target: 0.95

## File Organization
- Status files: .claude-project/status/{project}/
- Design files: .claude-project/design/ and .claude-project/generated-screens/
- Documentation: .claude-project/docs/
- User stories: .claude-project/user_stories/
