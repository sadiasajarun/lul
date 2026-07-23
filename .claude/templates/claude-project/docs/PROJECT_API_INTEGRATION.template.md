# API Integration Status: {PROJECT_NAME}

## Overview

This document tracks which frontend pages use which API endpoints.

## Frontend Pages → API Mapping

### Authentication Pages

| Page | APIs Used | Status |
|------|-----------|--------|
| `/login` | `POST /auth/login` | Pending |
| `/register` | `POST /auth/register` | Pending |
| `/forgot-password` | `POST /auth/forgot-password` | Pending |

### Dashboard Pages

| Page | APIs Used | Status |
|------|-----------|--------|
| `/dashboard` | `GET /users/me`, `GET /stats` | Pending |
| `/profile` | `GET /users/me`, `PATCH /users/:id` | Pending |

### Admin Pages (Dashboard)

| Page | APIs Used | Status |
|------|-----------|--------|
| `/admin/users` | `GET /users`, `DELETE /users/:id` | Pending |
| `/admin/settings` | `GET /settings`, `PATCH /settings` | Pending |

## API Service Files

| Service | Location | Endpoints |
|---------|----------|-----------|
| AuthService | `src/services/auth.ts` | login, register, logout |
| UserService | `src/services/user.ts` | getUsers, getUser, updateUser |

## Integration Checklist

- [ ] Set up Axios instance with base URL
- [ ] Configure auth interceptors
- [ ] Implement error handling
- [ ] Add loading states
- [ ] Add error states
- [ ] Test all endpoints
