# OVERVA Conversation Memory Contract v1

Status: accepted product contract for the public browser-local prototype;
server-backed tenant implementation remains a subsequent slice.

## Purpose

OVERVA must help a person resume work without pretending that every discussion,
AI interpretation, preview interaction, or uploaded source was approved or
executed. Durable workspace memory replaces dependence on one chat transcript,
one AI model context window, or one agent session.

## Seven memory layers

| Layer | Meaning | May change canonical data? |
| --- | --- | --- |
| Evidence | User text, file metadata, image, document, system inventory, or observation received from a source | No |
| Discussion | Ideas and alternatives mentioned during conversation | No |
| Hypothesis | OVERVA's normalized interpretation or proposed meaning | No |
| Confirmed understanding | A human accepted or corrected a specific hypothesis | No; it creates an approved baseline only |
| Plan | Agreed next work, order, owner, and success condition | No |
| Execution and verification | An authorized action, its result, and verification evidence | Only through the owning governed workflow |
| Checkpoint | Compact current state, unresolved questions, and next safe action | No |

These layers are linked, versioned, and never collapsed into one generic
"memory" field.

## Promotion rules

1. Evidence can create a hypothesis, never a confirmed fact.
2. A preview is a test artifact. Opening, selecting, or clicking it is not human
   approval and is not execution.
3. Only an explicit accept or correction decision promotes a hypothesis to a
   confirmed understanding.
4. Confirmation does not itself authorize canonical data mutation.
5. Execution requires the permission, validation, approval, idempotency, and
   audit rules of the owning OVERVA capability.
6. A verified outcome records what actually happened; it never rewrites the
   source evidence or earlier decision.
7. A newer interpretation supersedes an earlier one by link and version. It
   does not silently replace history.

## Resume response contract

When asked "Сүүлд юу хийсэн?", "Хаана зогссон?", or an equivalent Latin-Mongol
question, the assistant answers in this order:

1. evidence received;
2. current OVERVA hypothesis and its confidence/basis;
3. confirmed and unconfirmed items;
4. preview-only interactions;
5. authorized execution and verified outcome, if any;
6. current blocker or unresolved question;
7. the next smallest safe action.

The response must explicitly say when no real execution occurred and when
canonical data remains unchanged.

## Agent context package

A new AI agent receives a bounded structured package instead of the entire raw
conversation:

```text
workspace identity and purpose
authorized participants and tenant boundary
evidence index with source references
open hypotheses and confidence
confirmed decisions and supersession links
approved plan and acceptance conditions
execution and verification outcomes
current checkpoint, blockers, and next safe action
```

Raw tenant evidence is loaded only when the active task and the caller's access
require it. Shared product knowledge never treats one tenant's evidence as a
fact about another tenant.

## Public prototype mapping

The public v8 prototype stores one compact checkpoint in browser local storage:

- source metadata and the latest user intent are evidence;
- the selected guide path is a pending hypothesis;
- the `Тийм, зөв` action records explicit confirmation;
- preview tabs, selections, and buttons are preview-only activity;
- no public preview action represents canonical execution;
- uploaded file content is not persisted and must be selected again;
- `Шинэ ажил` clears the browser-local checkpoint.

On a later visit the public site shows a resume choice before restoring the
preview. It does not automatically present an old preview as current truth.

## Authenticated implementation boundary

The later server-backed implementation must be tenant-scoped and append-only,
reuse existing evidence/interview/decision foundations where their semantics
match, and add workspace checkpoint projections rather than duplicating tenant
master data. It requires authorization, retention controls, audit coverage,
context-package versioning, and tests preventing unconfirmed material from
becoming a confirmed baseline or executable command.
