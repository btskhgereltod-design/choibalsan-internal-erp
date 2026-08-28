# OVERVA Connect Contract V1

## Purpose

OVERVA Connect extends the existing tenant-scoped integration contracts,
adapters, webhooks, execution journal, retry, dead-letter, and audit foundations.
It is not a claim that OVERVA already provides a national connector standard or
a mature connector marketplace.

The first target is deliberately narrow: prove that one business event can be
validated once and used by several authorized workflows without duplicating the
original business action.

## Product boundary

```text
Source system or OVERVA workspace
              |
              v
Provider adapter and source validation
              |
              v
Versioned OVERVA event envelope
              |
              v
Tenant permission + integration contract
              |
              v
Authorized target workflow(s)
              |
              v
Execution evidence + reconciliation
```

Connect does not make OVERVA the owner of every datum. Each contract must state
the source of truth, target, update/conflict policy, mapping, latency, retry,
idempotency, and human-review boundary.

## Canonical envelope

V1 validates this transport envelope before domain-specific processing:

- `specVersion`: envelope contract version, currently `1.0`;
- `eventId`: globally unique event identity;
- `eventType`: stable business meaning such as `inventory.goods-received`;
- `schemaVersion`: version of the event's domain payload;
- `occurredAt`: when the business fact occurred;
- `source.system` and `source.reference`: attributable provenance;
- `subject.type` and `subject.id`: affected business object;
- `correlationId` and optional `causationId`: trace across workflows;
- `data`: domain payload governed by the event type and schema version.

Tenant identity is intentionally absent from the client-supplied envelope.
OVERVA derives the tenant from authenticated server context. Validation returns
a deterministic SHA-256 fingerprint, does not retain the payload, and cannot
mutate canonical organizational data.

The envelope is common; domain payloads are not one universal data model. Each
business domain evolves through small, versioned schemas and explicit backward-
compatibility rules.

## First proof slice

The first candidate is `inventory.goods-received`:

```text
Approved goods receipt
  -> inventory balance update
  -> accounting draft proposal
  -> cost allocation proposal
  -> management visibility
  -> attributable audit and reconciliation
```

Only the envelope validator is implemented in this slice. Target writes,
accounting effects, and multi-system delivery remain blocked until concrete
source/target contracts, authorization, acceptance criteria, rollback, and
reconciliation are approved.

## OAuth connector-account slice

The first provider-account slice is separate from canonical business-event
delivery. It lets the public Home describe real connector capabilities while
keeping authorization inside the authenticated tenant application.

- Initial providers: Google Drive read-only, Google Sheets read-only, and
  GitHub public repository read-only.
- Public catalog entries contain product metadata and readiness only. They do
  not expose credentials, tenant connection state, or private provider data.
- Only a tenant owner or administrator with `connectors.manage` can connect,
  test, reconnect, or disconnect an account.
- OAuth state is random, stored only as a SHA-256 digest, tenant/user bound,
  single-use, and expires after ten minutes.
- Access and refresh tokens are authenticated-encrypted with AES-256-GCM. Token
  material is never returned to the browser or written to audit details.
- Disconnecting clears retained token material while preserving attributable,
  append-only connection evidence.
- Resource-list checks are live provider reads and do not copy provider content
  into canonical OVERVA data.

Provider OAuth client registrations and the independent token-encryption secret
are deployment prerequisites. If they are absent, the catalog remains visible
and honestly reports that connection setup is waiting.

## Ecosystem maturity gates

Connector marketplace or certification must not be described as implemented
until real adapters have passed all of these gates:

1. versioned contract and sample payload;
2. tenant-isolation and permission tests;
3. secret handling and endpoint security review;
4. idempotency, retry, dead-letter, and replay tests;
5. source-to-target reconciliation;
6. ownership, support, deprecation, and incident responsibilities;
7. real pilot evidence from at least two independent systems.

GPS/IoT control remains outside an ordinary business-event connector. It keeps
its separate safety boundary, including local autonomy, acknowledgement,
reported state, fail-safe behavior, and Emergency > Manual > Weather > Schedule
> Default precedence at every control layer.
