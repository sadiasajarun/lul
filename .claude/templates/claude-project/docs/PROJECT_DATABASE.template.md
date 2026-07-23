# Database Schema: {PROJECT_NAME}

## Overview

- **Database**: PostgreSQL
- **ORM**: TypeORM / Prisma
- **Migrations**: [Location of migration files]

<!-- Generic Template ERD -->
<!-- This section will be removed if project has PRD-specific database schema -->

## Entity Relationship Diagram

### Detailed ERD with Attributes

This comprehensive ERD demonstrates all major relationship types with complete attribute listings.

```
┌──────────────────────────────────┐              ┌──────────────────────────────────┐
│            users                 │              │          profiles                │
├──────────────────────────────────┤              ├──────────────────────────────────┤
│ 🔑 id (PK)          UUID         │──────1:1─────│ 🔑 id (PK)          UUID         │
│   email             VARCHAR(255) │              │ 🔗 user_id (FK)     UUID         │
│   password          VARCHAR(255) │              │   avatar            VARCHAR(255) │
│   name              VARCHAR(100) │              │   bio               TEXT         │
│   role              ENUM         │              │   phone             VARCHAR(50)  │
│   created_at        TIMESTAMP    │              │   created_at        TIMESTAMP    │
│   updated_at        TIMESTAMP    │              │   updated_at        TIMESTAMP    │
└──────────────────────────────────┘              └──────────────────────────────────┘
                │
                │
                │ 1:N (author)
                │
                ▼
┌──────────────────────────────────┐              ┌──────────────────────────────────┐
│            posts                 │              │          comments                │
├──────────────────────────────────┤              ├──────────────────────────────────┤
│ 🔑 id (PK)          UUID         │──────1:N─────│ 🔑 id (PK)          UUID         │
│ 🔗 user_id (FK)     UUID         │              │ 🔗 post_id (FK)     UUID         │
│   title             VARCHAR(255) │              │ 🔗 user_id (FK)     UUID         │────┐
│   content           TEXT         │              │   content           TEXT         │    │
│   status            ENUM         │              │   status            ENUM         │    │
│   published_at      TIMESTAMP    │              │   created_at        TIMESTAMP    │    │
│   created_at        TIMESTAMP    │              │   updated_at        TIMESTAMP    │    │
│   updated_at        TIMESTAMP    │              └──────────────────────────────────┘    │
└──────────────────────────────────┘                                                      │
                │                                                                         │
                │                                                                         │
                │ N:N (tagging)                         1:N (commenter)                  │
                │                                                                         │
                ▼                                                                         │
┌──────────────────────────────────┐              ┌───────────────────────────────────┐ │
│          post_tags               │              │           users                   │◄┘
│      (Junction Table)            │              │      (reference above)            │
├──────────────────────────────────┤              └───────────────────────────────────┘
│ 🔑🔗 post_id (PK, FK) UUID       │
│ 🔑🔗 tag_id (PK, FK)  UUID       │──────┐
│   created_at          TIMESTAMP  │      │
└──────────────────────────────────┘      │
                                          │
                                          │
                                          ▼
                              ┌──────────────────────────────────┐
                              │            tags                  │
                              ├──────────────────────────────────┤
                              │ 🔑 id (PK)          UUID         │
                              │   name              VARCHAR(50)  │
                              │   slug              VARCHAR(50)  │
                              │   color             VARCHAR(7)   │
                              │   created_at        TIMESTAMP    │
                              └──────────────────────────────────┘


┌──────────────────────────────────┐
│           roles                  │
├──────────────────────────────────┤
│ 🔑 id (PK)          UUID         │
│   name              VARCHAR(50)  │──────┐
│   description       TEXT         │      │
│   permissions       JSONB        │      │
│   created_at        TIMESTAMP    │      │
└──────────────────────────────────┘      │
                                          │
                                          │ N:N (authorization)
                                          │
                                          ▼
                              ┌──────────────────────────────────┐
                              │         user_roles               │
                              │      (Junction Table)            │
                              ├──────────────────────────────────┤
                              │ 🔑🔗 user_id (PK, FK) UUID       │─────┐
                              │ 🔑🔗 role_id (PK, FK) UUID       │     │
                              │   assigned_at         TIMESTAMP  │     │
                              │   assigned_by         UUID       │     │
                              └──────────────────────────────────┘     │
                                                                       │
                                                                       │
                                          ┌────────────────────────────┘
                                          │
                                          ▼
                              ┌──────────────────────────────────┐
                              │           users                  │
                              │      (reference above)            │
                              └──────────────────────────────────┘

Legend:
🔑 Primary Key (PK)
🔗 Foreign Key (FK)
──  Relationship line
1:1 One-to-One relationship (each user has exactly one profile)
1:N One-to-Many relationship (one parent entity, many child entities)
N:1 Many-to-One relationship (many child entities, one parent entity)
N:N Many-to-Many relationship (requires junction table with composite PK)
```

## Entity Relationships

### One-to-One (1:1)

| Parent | Child | FK Column | Constraint |
|--------|-------|-----------|------------|
| users | profiles | profiles.user_id → users.id | UNIQUE, NOT NULL, ON DELETE CASCADE |

### One-to-Many (1:N)

| Parent | Child | Relationship | FK Column |
|--------|-------|--------------|-----------|
| users | posts | One user has many posts | posts.user_id → users.id |
| users | comments | One user has many comments | comments.user_id → users.id |

### Many-to-Many (N:N)

| Entity 1 | Entity 2 | Junction Table | Columns | Description |
|----------|----------|----------------|---------|-------------|
| users | roles | user_roles | user_id, role_id | Users can have multiple roles |
| posts | tags | post_tags | post_id, tag_id | Posts can have multiple tags |

### Relationship Details

**users → profiles (1:1)**
- Type: One-to-One
- Constraint: profiles.user_id UNIQUE, NOT NULL
- On Delete: CASCADE
- Description: Each user has exactly one profile

**users → posts (1:N)**
- Type: One-to-Many
- Constraint: posts.user_id NOT NULL
- On Delete: CASCADE
- Description: Each user can create multiple posts

**users ← → roles (N:N)**
- Type: Many-to-Many
- Junction: user_roles (user_id, role_id)
- Constraint: Composite PK (user_id, role_id)
- Description: Users can have multiple roles (e.g., admin, editor, viewer)

## Tables

### users

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | No | auto | Primary key |
| email | VARCHAR(255) | No | - | Unique email |
| password | VARCHAR(255) | No | - | Hashed password |
| name | VARCHAR(100) | Yes | NULL | Display name |
| role | ENUM | No | 'user' | user/admin |
| created_at | TIMESTAMP | No | NOW() | Creation time |
| updated_at | TIMESTAMP | No | NOW() | Last update |

### profiles

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | No | gen_random_uuid() | Primary key |
| user_id | UUID | No | - | FK to users.id (UNIQUE) |
| avatar | VARCHAR(255) | Yes | NULL | Avatar URL |
| bio | TEXT | Yes | NULL | User bio |
| phone | VARCHAR(50) | Yes | NULL | Phone number |
| created_at | TIMESTAMP | No | NOW() | Creation time |
| updated_at | TIMESTAMP | No | NOW() | Last update |

**Constraints:**
- UNIQUE (user_id)
- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

### posts

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | No | gen_random_uuid() | Primary key |
| user_id | UUID | No | - | FK to users.id |
| title | VARCHAR(255) | No | - | Post title |
| content | TEXT | No | - | Post content |
| status | ENUM | No | 'draft' | draft, published, archived |
| published_at | TIMESTAMP | Yes | NULL | Publication timestamp |
| created_at | TIMESTAMP | No | NOW() | Creation time |
| updated_at | TIMESTAMP | No | NOW() | Last update |

**Constraints:**
- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

### comments

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | No | gen_random_uuid() | Primary key |
| post_id | UUID | No | - | FK to posts.id |
| user_id | UUID | No | - | FK to users.id |
| content | TEXT | No | - | Comment content |
| status | ENUM | No | 'active' | active, hidden, deleted |
| created_at | TIMESTAMP | No | NOW() | Creation time |
| updated_at | TIMESTAMP | No | NOW() | Last update |

**Constraints:**
- FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
- FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

### roles

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | No | gen_random_uuid() | Primary key |
| name | VARCHAR(50) | No | - | Role name (e.g., admin, editor, viewer) |
| description | TEXT | Yes | NULL | Role description |
| permissions | JSONB | No | '[]' | Permission array |
| created_at | TIMESTAMP | No | NOW() | Creation time |

**Constraints:**
- UNIQUE (name)

### tags

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | No | gen_random_uuid() | Primary key |
| name | VARCHAR(50) | No | - | Tag name |
| slug | VARCHAR(50) | No | - | URL-friendly slug |
| color | VARCHAR(7) | Yes | '#000000' | Hex color code |
| created_at | TIMESTAMP | No | NOW() | Creation time |

**Constraints:**
- UNIQUE (name)
- UNIQUE (slug)

## Junction Tables (Many-to-Many)

Junction tables implement many-to-many relationships between two entities. They use composite primary keys consisting of both foreign keys.

### user_roles (Users ↔ Roles)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| user_id | UUID | No | - | FK to users.id |
| role_id | UUID | No | - | FK to roles.id |
| assigned_at | TIMESTAMP | No | NOW() | When role was assigned |
| assigned_by | UUID | Yes | NULL | FK to users.id (who assigned) |

**Constraints:**
- Primary Key: (user_id, role_id)
- Foreign Key: user_id REFERENCES users(id) ON DELETE CASCADE
- Foreign Key: role_id REFERENCES roles(id) ON DELETE CASCADE
- Foreign Key: assigned_by REFERENCES users(id) ON DELETE SET NULL
- Unique: (user_id, role_id)

**Purpose:** Allows users to have multiple roles (e.g., a user can be both an editor and a moderator).

### post_tags (Posts ↔ Tags)

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| post_id | UUID | No | - | FK to posts.id |
| tag_id | UUID | No | - | FK to tags.id |
| created_at | TIMESTAMP | No | NOW() | When tag was added |

**Constraints:**
- Primary Key: (post_id, tag_id)
- Foreign Key: post_id REFERENCES posts(id) ON DELETE CASCADE
- Foreign Key: tag_id REFERENCES tags(id) ON DELETE CASCADE
- Unique: (post_id, tag_id)

**Purpose:** Allows posts to have multiple tags and tags to be associated with multiple posts.

<!-- End Generic Template ERD -->

## Indexes

### Primary Tables

| Table | Index | Columns | Type | Purpose |
|-------|-------|---------|------|---------|
| users | users_email_idx | email | UNIQUE | Fast email lookup for login |
| users | users_role_idx | role | BTREE | Filter users by role |
| profiles | profiles_user_id_idx | user_id | UNIQUE | Enforce 1:1 with users |
| posts | posts_user_id_idx | user_id | BTREE | Find all posts by user |
| posts | posts_status_idx | status | BTREE | Filter posts by status |
| posts | posts_published_at_idx | published_at | BTREE | Sort by publish date |
| comments | comments_post_id_idx | post_id | BTREE | Find all comments for a post |
| comments | comments_user_id_idx | user_id | BTREE | Find all comments by user |
| comments | comments_post_user_idx | (post_id, user_id) | BTREE | Find user's comments on a post |
| roles | roles_name_idx | name | UNIQUE | Ensure unique role names |
| tags | tags_name_idx | name | UNIQUE | Ensure unique tag names |
| tags | tags_slug_idx | slug | UNIQUE | URL-friendly tag lookup |

### Junction Tables

Junction tables have composite primary keys that automatically serve as indexes for their constituent columns.

| Table | Composite PK | Serves As Index For |
|-------|--------------|---------------------|
| user_roles | (user_id, role_id) | Fast lookup of user's roles and role's users |
| post_tags | (post_id, tag_id) | Fast lookup of post's tags and tag's posts |

**Additional Indexes:**
- user_roles: role_id index (for reverse lookup: "which users have this role?")
- post_tags: tag_id index (for reverse lookup: "which posts have this tag?")

## Migrations

```bash
# Generate migration
npm run migration:generate -- -n MigrationName

# Run migrations
npm run migration:run

# Revert last migration
npm run migration:revert
```
