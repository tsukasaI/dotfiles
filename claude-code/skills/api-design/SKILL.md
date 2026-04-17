---
description: Design stable, well-documented APIs and interfaces
when_to_use: When designing a new REST or internal API, adding endpoints, changing existing contracts, renaming fields, introducing versioning, or reviewing API surface for consistency and backward compatibility.
---

# API and Interface Design

Define the interface contract before implementation.

## Principles

- **Contract first**: Spec before code. Establish clear expectations for providers and consumers.
- **Consistent errors**: One error strategy applied uniformly. Structured responses with machine-readable codes.
- **Boundary validation**: Trust internal code. Validate at system edges where external input enters. Treat third-party API responses as untrusted.
- **Additive changes**: Extend through optional fields. Never modify existing fields in breaking ways.
- **Hyrum's Law**: All observable behaviors become depended on, regardless of what the contract promises.

## REST Patterns

- Resource-oriented: plural nouns, no verbs (`/tasks`, not `/getTasks`)
- `GET` collection, `GET` item, `POST` create, `PATCH` partial update, `DELETE` remove
- Pagination on all list endpoints
- Consistent envelope: `{ data, meta, errors }`

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Resources | plural nouns | `/users`, `/tasks` |
| Fields | camelCase | `createdAt`, `userId` |
| Enums | UPPER_SNAKE | `TASK_STATUS`, `ROLE_ADMIN` |
| Booleans | is/has/can prefix | `isActive`, `hasPermission` |
| Query params | camelCase | `sortBy`, `pageSize` |

## TypeScript Patterns

- Discriminated unions for variant types
- Separate input/output types (`CreateTaskInput` vs `Task`)
- Branded types for IDs to prevent mixing (`UserId` vs `TaskId`)

## Versioning

Prefer extension and deprecation over maintaining multiple versions (One-Version Rule). When breaking changes are unavoidable, use explicit versioning with clear migration path.
