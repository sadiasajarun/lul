# Ship Phase Rules

## Process
- Run production build for both frontend and backend ✅ gate: `backend-build`, `frontend-build`
- Verify all environment variables are configured ✅ gate: `env-example-complete`
- Calculate drift from original seed specification
- Only ship if drift <= 0.2

## Quality
- Production builds must succeed with zero warnings
- All env vars must have values (check .env.example)
- Docker containers must start cleanly (if using Docker)
- No development dependencies in production bundles
- No weak/default secrets in config files ✅ gate: `no-weak-secrets`
- No console.log in production code ✅ gate: `no-console-logs`
- No .env files committed to git ✅ gate: `no-env-committed`

## Scope Guard
- ONLY modify: docker-compose.prod.yml, ecosystem.config.js, .env files
- May create deployment configuration files
- Do NOT modify source code — only deployment config
- Do NOT add features or fix bugs during ship phase
