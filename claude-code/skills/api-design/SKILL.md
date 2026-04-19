---
name: api-design
description: Design stable, well-documented APIs and interfaces — contract before code. Use when designing a new REST or internal API, adding endpoints, changing existing contracts, renaming fields, introducing versioning, or reviewing API surface for consistency and backward compatibility.
---

# API and Interface Design

Fix the contract before the implementation. Every observable behavior will be depended on (Hyrum's Law), so what you ship is what you owe.

## When to use

- New REST endpoint, RPC method, or public TypeScript interface
- Adding, renaming, or removing fields on an existing contract
- Introducing or retiring an API version
- Reviewing an API surface for internal consistency

When NOT to use:
- Internal helpers with a single caller (just refactor)
- Type-level-only renames that never cross a process boundary
- Throwaway scripts or one-off tools

## Workflow

1. **Enumerate the current surface** — list affected endpoints / methods / types before changing anything. You cannot reason about a contract you have not seen whole.
2. **Classify the change** — additive (new optional field, new endpoint), neutral (docs, internal rename), or breaking (type change, required field, removal, semantic shift).
3. **Prefer additive** — extend via optional fields and new endpoints. Deprecate rather than delete. One-Version Rule: avoid maintaining parallel versions when a deprecation path exists.
4. **If breaking is unavoidable** — write the migration path first (version bump, dual-read window, consumer notification). The migration note is part of the design artifact.
5. **Write the contract** — schema, examples, error shapes, pagination, auth. Include at least one success and one failure example per endpoint.
6. **Review against principles** (below) before shipping.

## Principles

- **Contract first** — spec before code; consumers and providers agree on the shape
- **Consistent errors** — one error strategy applied uniformly, with machine-readable codes
- **Boundary validation** — trust internal code; validate at system edges; treat third-party API responses as untrusted
- **Additive changes** — extend through optional fields; never mutate existing field semantics
- **Hyrum's Law** — every observable behavior is depended on regardless of what the docs say

## REST patterns

- Resource-oriented: plural nouns, no verbs (`/tasks`, not `/getTasks`)
- `GET` collection, `GET` item, `POST` create, `PATCH` partial update, `DELETE` remove
- Pagination on all list endpoints
- Consistent envelope: `{ data, meta, errors }`

## Naming conventions

| Type | Convention | Example |
|------|-----------|---------|
| Resources | plural nouns | `/users`, `/tasks` |
| Fields | camelCase | `createdAt`, `userId` |
| Enums | UPPER_SNAKE | `TASK_STATUS`, `ROLE_ADMIN` |
| Booleans | is/has/can prefix | `isActive`, `hasPermission` |
| Query params | camelCase | `sortBy`, `pageSize` |

## TypeScript patterns

- Discriminated unions for variant types
- Separate input/output types (`CreateTaskInput` vs `Task`)
- Branded types for IDs to prevent mixing (`UserId` vs `TaskId`)

## Output format

```
# API design: <surface name>

## Change classification
- Type: additive | neutral | breaking
- Affected consumers: <list or "internal only">

## Contract
<schema / types / endpoint table>

## Examples
- Success: <request → response>
- Failure: <request → error shape>

## Migration (only for breaking)
- Dual-read window: <dates or versions>
- Consumer action: <what callers must do>
- Deprecation removal: <when>

## Open questions
- <anything the reviewer should decide>
```

## Red flags

| Rationalization | Reality |
|---|---|
| "It's internal, so we can change it later." | Every internal caller will grow to depend on current behavior. Changing later is the same cost. |
| "The field name is obvious, no doc needed." | Obvious to the author, ambiguous to the reader six months later. Document the units, nullability, and enum values. |
| "Just bump the major version — clean break." | Versioning is the expensive option. Exhaust additive + deprecation first. |
| "I'll mirror the existing error shape exactly." | Good — unless the existing shape is wrong. One uniform error strategy beats two consistent-with-each-other mistakes. |
| "Validation at the edge is slow; skip it here." | Boundary validation is the contract. Skipping it moves the failure to a much worse place. |
