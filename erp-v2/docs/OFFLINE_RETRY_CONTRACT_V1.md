# Offline and retry command contract V1

Status: accepted foundation contract; no domain workflow is implemented by this
document.

## Boundary

Offline capability never changes server authority. The authenticated server
derives the tenant, actor, permissions, current domain state and workflow
version. A client must not place an organization identifier in a queued command.

Two client modes exist:

1. `draft_queue` stores a local, visibly unconfirmed draft such as `draft.save`
   or `comment.draft`. It may be retried later but is not a server record.
2. `server_confirmation` stores a request awaiting the server. Unknown commands
   default to this stricter mode.

Approval, rejection, return, termination, archive destruction, final close and
permission/security changes always require server confirmation. While offline,
the UI must show them as queued/awaiting confirmation and must never display a
final, approved, rejected, terminated, destroyed, closed or permission-changed
state.

## Retry identity

Every queued request carries a client-generated UUID `requestId` and UUID
`idempotencyKey`. Retrying the same logical command reuses both values and the
exact payload. A changed payload requires a new identity. The server rejects a
reused idempotency key with a different payload and rejects stale optimistic
versions.

The client may mark a command final only after a response echoes both identities,
states `confirmed=true`, and provides the accepted server version. A timeout,
provider outage, network error or ambiguous response remains unconfirmed and is
safe to retry.

## Outbox relationship

The business transaction and immutable notification intent commit together.
External notification delivery is asynchronous and cannot roll back the domain
transaction. Delivery retries use the immutable outbox ID as provider
idempotency identity and retain append-only attempt evidence.
