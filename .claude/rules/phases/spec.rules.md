# Spec Phase Rules

## Process
- Read existing seed file before interviewing (avoid re-asking known answers)
- If PRD provided, run gap analysis before full interview
- Score ambiguity after each round — stop at <= 0.2
- Seed YAML must have: goal, constraints, acceptance_criteria, ontology

## Quality
- Goal must be a single measurable sentence
- Acceptance criteria must be specific and testable (no vague terms)
- Ontology terms must include definitions, not just names
- Constraints must distinguish hard vs soft limits

## Scope Guard
- ONLY create files under: .claude-project/status/{project}/
- ONLY modify: PIPELINE_STATUS.md (seed_id field)
- Do NOT create code, design, or documentation files
- Do NOT modify .claude-rules or project structure
