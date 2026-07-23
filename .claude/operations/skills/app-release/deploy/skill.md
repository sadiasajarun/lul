---
name: store-deploy
description: Production server deployment guide - HTTPS, domain, environment variables, Docker production configuration
user-invocable: true
argument-hint: "[check|env|docker|ssl|all]"
---

# Store Deploy - Production Deployment Preparation

## Purpose

Handles all preparation steps for deploying the production server that the WebView app will connect to.
Transitions the current development environment settings to production and strengthens security configurations.

## Usage

```
/store-deploy              # Full deployment readiness check
/store-deploy check        # Diagnose current production readiness
/store-deploy env          # Environment variable production transition guide
/store-deploy docker       # Docker production configuration optimization
/store-deploy ssl          # HTTPS/SSL configuration guide
/store-deploy all          # Execute full deployment preparation
```

## Pre-flight

Before generating any output, execute the **Pre-flight: Gitignore Output Directory** from [Store Shared Reference](../_store-shared/reference.md). This ensures `.claude-project/` is in `.gitignore` before any files are created.

## Prerequisites

- `/store-prep` completed
- Server infrastructure decided (AWS, GCP, NCP, etc.)

---

## Phase 1: Production Readiness Diagnosis (`/store-deploy check`)

### Execution Algorithm

1. **Security vulnerability scan**:
   ```
   Grep: test_ | test- | 12345 | password | secret → Detect test keys in .env* files
   Grep: localhost | 127.0.0.1 → Detect hardcoded local addresses
   Grep: console.log | debugger → Detect debug code
   Grep: CORS.*\* → Detect overly permissive CORS settings
   ```

2. **Configuration file inspection**:
   - Compare `.env.example` against production requirements
   - Verify Docker configuration is in production mode
   - Verify PM2 configuration is in production mode

3. **Diagnostic report output**:
   ```markdown
   # Production Readiness Status

   ## 🔴 Immediate Fix Required
   - [ ] JWT secret is using default value (.env:AUTH_JWT_SECRET)
   - [ ] Toss payment test keys are in use
   - [ ] DB password is "12345"

   ## 🟡 Recommended Fixes
   - [ ] Restrict CORS allowed domains to production domain
   - [ ] Change log level to production

   ## ✅ No Issues
   - Docker production configuration exists
   - PM2 configuration exists
   ```

---

## Phase 2: Environment Variable Transition (`/store-deploy env`)

### Execution Algorithm

1. Analyze `.env.example` and generate a production `.env.production.example`
2. Production transition guide for each environment variable:

   ```markdown
   | Variable | Current (Dev) | Production | Notes |
   |----------|--------------|------------|-------|
   | MODE | DEV | PRODUCTION | |
   | POSTGRES_PASSWORD | 12345 | (strong password) | Minimum 16 characters |
   | AUTH_JWT_SECRET | pRojEct2025_... | (random 256bit) | Generate with openssl rand |
   | TOSS_CLIENT_ID | test_ck_... | live_ck_... | Issue from Toss dashboard |
   | TOSS_SECRET_KEY | test_sk_... | live_sk_... | Issued by client |
   | FRONTEND_URL | localhost:5173 | https://app.domain.com | |
   | ALLOW_ORIGINS | localhost:* | https://app.domain.com | |
   ```

3. Secret generation scripts:
   ```bash
   # Generate JWT secret
   openssl rand -base64 64
   # Generate DB password
   openssl rand -base64 32
   ```

---

## Phase 3: Docker Production Configuration (`/store-deploy docker`)

### Execution Algorithm

1. Analyze existing `docker-compose.prod.yml`
2. Production optimization checklist:
   - [ ] Multi-stage build (minimize image size)
   - [ ] Health check configuration
   - [ ] Resource limits (memory, cpu)
   - [ ] Log driver configuration
   - [ ] Volume mounts (data persistence)
   - [ ] Network isolation
   - [ ] Auto-restart policy

3. Generate Nginx reverse proxy configuration (if not present):
   - SSL termination
   - WebSocket proxy (for Socket.IO)
   - Static file caching
   - GZIP compression

---

## Phase 4: HTTPS/SSL (`/store-deploy ssl`)

### Execution Algorithm

1. SSL configuration method guidance:
   - **Option A**: Let's Encrypt (free, auto-renewal)
   - **Option B**: Cloud-provided SSL (AWS ACM, CloudFlare, etc.)
   - **Option C**: Purchase paid certificate

2. Generate Nginx + Let's Encrypt automation configuration
3. Set up certificate auto-renewal cron job

---

## Deliverables

```
.claude-project/store-prep/deploy/
├── deploy-checklist.md        # Pre-deployment checklist
├── env.production.example     # Production environment variable template
├── nginx.conf                 # Nginx reverse proxy configuration
├── docker-compose.prod.yml    # Production Docker configuration (improved)
└── ssl-setup.md               # SSL setup guide
```
