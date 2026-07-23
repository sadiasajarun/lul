# Project Knowledge: {PROJECT_NAME}

## Overview

[Brief description of what this project does]

## Tech Stack

- **Backend**: {BACKEND}
- **Frontend**: {FRONTENDS}
- **Database**: [PostgreSQL/MySQL/etc.]
- **Deployment**: [Docker/Kubernetes/etc.]

## Architecture

### Project Structure

```
{PROJECT_NAME}/
├── backend/                       # {BACKEND} API server
├── frontend/                      # React web application
├── frontend-admin-dashboard/      # Admin dashboard (if applicable)
├── frontend-operations-dashboard/ # Operations dashboard (if applicable)
├── frontend-analytics-dashboard/  # Analytics dashboard (if applicable)
├── mobile/                        # React Native mobile app (if applicable)
└── docker-compose.yml             # Container orchestration
```

### Backend Architecture ({BACKEND})

<!-- NestJS Backend Architecture -->
<!-- Include this section if {BACKEND} = "nestjs" -->

#### NestJS Four-Layer Architecture

```
backend/src/
├── core/                          # Framework-level code
│   ├── base/                      # Base classes (extend these)
│   │   ├── base.entity.ts         # UUID, timestamps, soft delete
│   │   ├── base.repository.ts     # CRUD operations
│   │   ├── base.service.ts        # Business logic methods
│   │   └── base.controller.ts     # HTTP endpoints
│   ├── decorators/                # Custom decorators
│   │   ├── current-user.decorator.ts  # @CurrentUser()
│   │   ├── public.decorator.ts        # @Public()
│   │   ├── roles.decorator.ts         # @Roles('admin')
│   │   └── api-swagger.decorator.ts   # @ApiSwagger()
│   ├── filters/                   # Exception filters
│   │   └── http-exception.filter.ts
│   ├── guards/                    # Guards (auth, roles)
│   │   ├── session-auth.guard.ts
│   │   └── roles.guard.ts
│   ├── interceptors/              # Interceptors
│   │   ├── transform.interceptor.ts
│   │   └── logging.interceptor.ts
│   └── pipes/                     # Pipes (validation)
│       └── validation.pipe.ts
│
├── modules/                       # Feature modules
│   ├── auth/
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.module.ts
│   │   ├── strategies/
│   │   │   ├── session.strategy.ts
│   │   │   └── local.strategy.ts
│   │   └── dtos/
│   │       ├── login.dto.ts
│   │       ├── register.dto.ts
│   │       └── auth-response.dto.ts
│   ├── users/
│   │   ├── user.entity.ts
│   │   ├── user.repository.ts
│   │   ├── user.service.ts
│   │   ├── user.controller.ts
│   │   ├── user.module.ts
│   │   └── dtos/
│   │       ├── create-user.dto.ts
│   │       ├── update-user.dto.ts
│   │       └── user-response.dto.ts
│   └── [feature]/                 # Feature modules follow same pattern
│       ├── [feature].entity.ts
│       ├── [feature].repository.ts
│       ├── [feature].service.ts
│       ├── [feature].controller.ts
│       ├── [feature].module.ts
│       └── dtos/
│
├── infrastructure/                # External services
│   ├── mail/
│   │   ├── mail.service.ts
│   │   └── mail.module.ts
│   ├── s3/
│   │   ├── s3.service.ts
│   │   └── s3.module.ts
│   └── logging/
│       └── winston.logger.ts
│
├── main.ts                        # Application entry point
└── app.module.ts                  # Root module
```

**Request Lifecycle:**
1. HTTP Request → NestJS Router
2. Guards execute (SessionAuthGuard, RolesGuard)
3. Interceptors (before) execute
4. Pipes validate DTOs with class-validator
5. Controller delegates to Service
6. Service executes business logic
7. Repository performs database operations
8. Response flows back through interceptors

**Key Patterns:**
- **Four-layer architecture**: Controller → Service → Repository → Entity
- **Dependency injection**: Via NestJS modules and constructor injection
- **Base classes**: Provide CRUD automatically (~90% boilerplate reduction)
- **TypeORM**: For database operations, entities, migrations
- **Module organization**: Each feature is self-contained NestJS module

**Separation of Concerns:**
- **Controller**: Route definitions, HTTP decorators (@Get, @Post, etc.), delegate to service
- **Service**: Business logic, orchestration, transaction management
- **Repository**: TypeORM operations, custom queries, data access
- **Entity**: Database schema, columns, relationships (@Column, @ManyToOne, etc.)
- **DTOs**: Input validation with class-validator, data transfer objects

**Detailed Guides:** `.claude/nestjs/guides/` - architecture-overview, routing-and-controllers, services-and-repositories, database-patterns, authentication, validation, testing

<!-- End NestJS section -->

<!-- Django Backend Architecture -->
<!-- Include this section if {BACKEND} = "django" -->

#### Django REST Framework Architecture

```
backend/
├── config/                        # Project configuration
│   ├── settings/
│   │   ├── __init__.py
│   │   ├── base.py               # Shared settings
│   │   ├── development.py        # Dev-specific settings
│   │   └── production.py         # Prod-specific settings
│   ├── urls.py                   # Root URL configuration
│   ├── wsgi.py                   # WSGI application
│   └── asgi.py                   # ASGI application
│
├── apps/                          # Django applications
│   ├── core/                      # Shared utilities
│   │   ├── __init__.py
│   │   ├── models.py             # BaseModel (UUID, timestamps, soft delete)
│   │   ├── views.py              # Base views (BaseViewSet)
│   │   ├── serializers.py        # Base serializers
│   │   ├── permissions.py        # Custom permissions
│   │   ├── pagination.py         # Custom pagination
│   │   ├── exceptions.py         # Custom exception handlers
│   │   └── middleware.py         # Custom middleware
│   │
│   ├── users/                     # User management
│   │   ├── __init__.py
│   │   ├── models.py             # User model
│   │   ├── managers.py           # Custom managers
│   │   ├── serializers.py        # UserSerializer, etc.
│   │   ├── views.py              # UserViewSet
│   │   ├── urls.py               # User routes
│   │   ├── admin.py              # Django admin config
│   │   ├── signals.py            # User signals
│   │   └── tests/
│   │       ├── __init__.py
│   │       ├── test_models.py
│   │       ├── test_views.py
│   │       └── test_serializers.py
│   │
│   └── [feature]/                 # Feature-specific apps
│       ├── __init__.py
│       ├── models.py
│       ├── serializers.py
│       ├── views.py
│       ├── urls.py
│       └── tests/
│
├── database/                      # Database migrations
│   └── migrations/
│
└── manage.py                      # Django CLI
```

**Request Flow:**
1. HTTP Request → URL Router
2. Authentication (SessionAuthentication)
3. Permission Check (IsAuthenticated, IsOwner, etc.)
4. ViewSet/APIView handling
5. Serializer validation & serialization
6. Model/Manager business logic
7. Django ORM queries
8. Database (PostgreSQL)

**Key Patterns:**
- **MTV + ViewSets**: Model → ViewSet → Serializer
- **Django ORM**: Query operations, managers, QuerySets
- **BaseModel pattern**: UUID primary keys, timestamps, soft delete
- **DRF serializers**: Input validation and output formatting
- **Permission classes**: Authentication and authorization
- **App-based organization**: Each feature is a Django app
- **Signals**: Event-driven logic (post_save, pre_delete, etc.)

**Separation of Concerns:**
- **Model**: Database schema, business logic, custom managers
- **ViewSet**: HTTP method handlers, permissions, filtering
- **Serializer**: Input validation, output formatting, nested serialization
- **URLs**: Route definitions with DRF router
- **Permissions**: Access control logic
- **Managers**: Custom QuerySet methods

**Detailed Guides:** `.claude/django/guides/` - architecture-overview, models-and-orm, serializers, views-and-urls, authentication, testing

<!-- End Django section -->

### Frontend Architecture (React)

<!-- React Web Architecture -->
<!-- Include this section if {FRONTENDS} contains "react" -->

```
frontend/app/
├── components/                    # Reusable components
│   ├── ui/                        # Shadcn/UI primitives
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── card.tsx
│   │   └── form.tsx
│   └── layout/                    # Layout components
│       ├── header.tsx
│       └── footer.tsx
├── hooks/                         # Custom React hooks
│   └── providers/                 # Context providers
│       └── providers.tsx          # Redux provider setup
├── lib/                           # Utility libraries
│   └── utils.ts                   # cn() utility
├── pages/                         # Page components
│   ├── layout.tsx                 # Main layout
│   ├── auth/                      # Authentication pages
│   │   ├── layout.tsx
│   │   ├── login.tsx
│   │   └── register.tsx
│   └── public/                    # Public pages
│       ├── home.tsx
│       └── about.tsx
├── redux/                         # State management
│   ├── features/                  # Redux slices
│   │   └── userSlice.ts
│   └── store/                     # Store configuration
│       ├── store.ts
│       ├── rootReducer.ts
│       └── hooks.ts               # useAppDispatch, useAppSelector
├── routes/                        # Route definitions
│   ├── public.routes.ts
│   └── auth.routes.ts
├── services/                      # API services
│   ├── httpService.ts             # Axios orchestrator
│   ├── httpMethods/               # HTTP method factories
│   │   ├── index.ts               # Export all methods
│   │   ├── get.ts                 # GET factory
│   │   ├── post.ts                # POST factory
│   │   ├── put.ts                 # PUT factory
│   │   ├── delete.ts              # DELETE factory
│   │   ├── patch.ts               # PATCH factory
│   │   ├── requestInterceptor.ts  # Request interceptor
│   │   └── responseInterceptor.ts # Response interceptor
│   └── httpServices/              # Domain-specific services
│       ├── queries/               # TanStack Query hooks (PUBLIC PAGES ONLY)
│       │   ├── index.ts
│       │   └── usePublicCategories.ts
│       ├── authService.ts
│       ├── userService.ts
│       └── [feature]Service.ts
├── styles/                        # CSS files
│   └── app.css                    # Tailwind + theme variables
├── types/                         # TypeScript types
│   ├── user.d.ts
│   └── httpService.d.ts
├── utils/                         # Utility functions
│   ├── errorHandler.ts
│   ├── actions/                   # Server actions
│   └── validations/               # Zod schemas
│       └── auth.ts
├── root.tsx                       # Root component
└── routes.ts                      # Main route config
```

**Service Layer Architecture:**

The frontend uses a three-tier service layer:

1. **httpService.ts** - Axios orchestrator with interceptors
2. **httpMethods/** - Factory functions for GET, POST, PUT, DELETE, PATCH
3. **httpServices/** - Domain-specific services using method factories
4. **httpServices/queries/** - TanStack Query hooks (PUBLIC PAGES ONLY)

**Request Flow:**
Component → Service Method → HTTP Method Factory → Axios Interceptors → Backend API

**Import Alias Patterns:**
- Alias: `~/` → `/app/`
- Use for all imports from app directory
- Avoids relative path hell (`../../../components`)

**Examples:**
```typescript
// ✅ Correct - using alias
import { Button } from '~/components/ui/button';
import { useAppDispatch } from '~/redux/store/hooks';
import type { User } from '~/types/user';

// ❌ Avoid - relative paths
import { Button } from '../../../components/ui/button';
```

**State Management:**
- **Redux**: Global state (user auth, app settings)
- **TanStack Query**: Server state (API data, caching)
- **React Hook Form**: Form state
- **Context API**: Component-level shared state

**When to Use What:**
- Redux: Cross-cutting concerns (auth, theme, app-wide settings)
- TanStack Query: API data fetching, caching, synchronization
- React Hook Form: Form validation and submission
- Local State: Component-specific state (useState, useReducer)

**Key Patterns:**
- React 19 with React Router
- Redux Toolkit for global state
- TanStack Query for server state
- Shadcn/UI + TailwindCSS 4
- Zod for validation
- TypeScript for type safety

**Detailed Guides:** `.claude/react/guides/` - file-organization, component-patterns, data-fetching, routing-guide, api-integration, state-management, form-handling

<!-- End React section -->

### Mobile Architecture (React Native)

<!-- React Native Mobile Architecture -->
<!-- Include this section if {FRONTENDS} contains "react-native" -->

```
mobile/src/
├── app/                           # Expo Router pages (file-based routing)
│   ├── (tabs)/                    # Tab navigation group
│   │   ├── _layout.tsx            # Tabs layout
│   │   ├── index.tsx              # Home tab
│   │   ├── profile.tsx            # Profile tab
│   │   └── settings.tsx           # Settings tab
│   ├── (auth)/                    # Auth screens group
│   │   ├── _layout.tsx            # Auth layout
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── [id].tsx                   # Dynamic route example
│   └── _layout.tsx                # Root layout
├── components/                    # Reusable components
│   ├── ui/                        # React Native Paper components
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   └── List.tsx
│   └── layout/                    # Layout components
│       ├── Screen.tsx
│       └── Container.tsx
├── hooks/                         # Custom React hooks
│   └── providers/                 # Context providers
│       └── providers.tsx          # Redux + React Query providers
├── lib/                           # Utility libraries
│   └── utils.ts
├── redux/                         # State management
│   ├── features/                  # Redux slices
│   │   └── userSlice.ts
│   └── store/                     # Store configuration
│       ├── store.ts
│       ├── rootReducer.ts
│       └── hooks.ts               # useAppDispatch, useAppSelector
├── services/                      # API services
│   ├── httpService.ts             # Axios orchestrator
│   ├── httpMethods/               # HTTP method factories
│   │   ├── index.ts
│   │   ├── get.ts
│   │   ├── post.ts
│   │   ├── put.ts
│   │   ├── delete.ts
│   │   ├── patch.ts
│   │   ├── requestInterceptor.ts
│   │   └── responseInterceptor.ts
│   └── httpServices/              # Domain-specific services
│       ├── queries/               # TanStack Query hooks
│       │   ├── index.ts
│       │   └── usePublicData.ts
│       ├── authService.ts
│       └── userService.ts
├── styles/                        # Global styles
│   └── theme.ts                   # Theme configuration
├── types/                         # TypeScript types
│   ├── user.d.ts
│   └── httpService.d.ts
├── utils/                         # Utility functions
│   ├── errorHandler.ts
│   └── validations/               # Zod schemas
│       └── auth.ts
├── root.tsx                       # App root (providers + HTML shell)
└── routes.ts                      # Declarative route config
```

**Expo Router Patterns:**
- **File-based routing**: No manual route configuration needed
- **Route groups**: Use `(groupName)` for organization without URL impact
- **Dynamic routes**: Use `[param]` for dynamic segments
- **Layouts**: `_layout.tsx` files wrap child routes

**Examples:**
- `app/(tabs)/home.tsx` → `/home` (tabs group hidden from URL)
- `app/(auth)/login.tsx` → `/login` (auth group hidden from URL)
- `app/posts/[id].tsx` → `/posts/123` (dynamic route)
- `app/_layout.tsx` → Root layout wraps all routes

**Service Layer Architecture:**

Same three-tier pattern as React web:

1. **httpService.ts** - Axios orchestrator with interceptors
2. **httpMethods/** - Factory functions for HTTP methods
3. **httpServices/** - Domain-specific services
4. **httpServices/queries/** - TanStack Query hooks

**Request Flow:**
Component → Service Method → HTTP Method Factory → Axios Interceptors → Backend API

**Import Alias Patterns:**
- Alias: `@/` → `/src/`
- Use for all imports from src directory

**Examples:**
```typescript
// ✅ Correct - using alias
import { Button } from '@/components/ui/Button';
import { useAppDispatch } from '@/redux/store/hooks';
import type { User } from '@/types/user';

// ❌ Avoid - relative paths
import { Button } from '../../../components/ui/Button';
```

**State Management:**
- **Redux**: Global state (user auth, app settings)
- **TanStack Query**: Server state (API data, caching)
- **Context API**: Component-level shared state
- **Local State**: Component-specific state

**Key Patterns:**
- Expo Router for file-based routing
- React Native Paper for UI components
- Redux Toolkit for global state
- TanStack Query for server state
- Zod for validation
- TypeScript for type safety

**Detailed Guides:** `.claude/react-native/guides/` - file-organization, component-patterns, navigation-guide, data-fetching, mobile-testing

<!-- End React Native section -->

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| [Decision 1] | [Why this choice was made] | YYYY-MM-DD |

## Development Setup

```bash
# Clone with submodules
git clone --recurse-submodules <repo-url>

# Start services
docker-compose up -d
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Database connection string | Yes |
| `SESSION_SECRET` | Session signing secret for httpOnly cookies | Yes |
| `COOKIE_DOMAIN` | Domain for cookie (e.g., .projectname.com) | Yes |

## External Services

| Service | Purpose | Documentation |
|---------|---------|---------------|
| [Service 1] | [What it's used for] | [Link] |
