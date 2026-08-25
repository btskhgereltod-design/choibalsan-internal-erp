# OVERVA AI Requirements Method

This document defines the reusable method used by OVERVA's organization and process discovery assistant. Reviewed BA lessons are source material, but their exercises, example companies, sample data, and document instructions are not product or tenant master data.

## Canonical analysis flow

1. Elicit evidence from the organization.
2. Separate `finding`, `business need`, `gap`, `requirement`, and `solution option`.
3. Model the current and desired workflow.
4. Decompose broad statements into independently testable requirements.
5. Prioritize by business value, customer impact, risk, compliance, dependency, urgency, and effort.
6. Allocate approved requirements to a release, module, workflow, or owner.
7. Verify quality, validate business value, obtain explicit approval, and create a versioned baseline.
8. Treat every later change as a new version with impact analysis; never silently overwrite a baseline.
9. Maintain bidirectional traceability from business need and evidence through requirement, process or feature, implementation, test, release, and measured outcome.

## Requirement quality gate

Every requirement is evaluated for:

- clarity;
- completeness;
- correctness against confirmed evidence;
- consistency with other requirements;
- feasibility;
- testability;
- traceability to its source and business need.

A user story uses `As a / I want / so that` and must have measurable acceptance criteria. Simple behavior can use a user story. Complex actors, branches, exceptions, or approvals require a workflow/use-case model.

## AI safety and learning contract

- AI asks, normalizes, summarizes, and proposes. It never applies an organization structure or changes canonical business data.
- A tenant answer is private evidence, not shared training data.
- Answers and decisions are append-only and versioned.
- A human must confirm normalized answers and approve any proposed blueprint.
- Reusable knowledge is promoted only after anonymization, outcome evidence, platform-admin review, and regression evaluation.
- Accepted, rejected, and modified proposals are all valuable feedback. Rejection is never hidden.
- The product catalog and controlled reference codes remain authoritative; vector retrieval, when introduced, is secondary.

## Adaptive organization interview

The minimum first interview covers:

1. organization form and operating context;
2. product, service, or public outcome delivered;
3. customer, beneficiary, or internal consumer;
4. work actually performed and its major workflow;
5. employee count, locations, shifts, and field work;
6. approvals, risks, regulated duties, and segregation of duties;
7. current source systems, documents, and import sources;
8. success measures and the first practical value expected from OVERVA.

The assistant branches from confirmed answers. It should not ask irrelevant questions merely because they exist in the catalog.

## Product use matrix

The same governed method can be reused without mixing tenant facts:

| OVERVA area | Method use |
| --- | --- |
| Organization setup | Identify operating context, stakeholders, scale, departments, positions, responsibilities, and approvals. |
| Smart Import | Identify source, owner, authority, field meaning, mapping, quality rules, exceptions, and human approval. |
| Process discovery | Capture trigger, activities, handoffs, waits, rework, exceptions, controls, and outcome. |
| Workflow design | Compare As-Is and To-Be, allocate responsibilities, model states, approvals, and failure paths. |
| Module selection | Link modules to confirmed business needs and gaps instead of showing every feature. |
| Management view | Define each KPI from a decision, formula, source, owner, refresh rule, baseline, and target. |
| Change request | Trace impact across business, requirement, process, system/data, time, effort, test, and risk. |
| Solution evaluation | Compare measured outcomes to the approved baseline and expected business value. |

## Method version governance

- `v1` remains usable until a platform administrator replaces it.
- `v2` contains the expanded ecosystem, needs, planning, elicitation, modeling, requirements, traceability, and monitoring knowledge.
- New versions are installed as `draft`. They cannot affect tenant interviews until a platform administrator explicitly activates them.
- Each knowledge unit traces to a reviewed source. The AI receives only a bounded, stage-relevant subset.

## Learning loop

`raw answer -> normalized confirmed answer -> draft requirement -> human decision -> applied blueprint diff -> 7/30 day outcome -> anonymized candidate -> admin review -> catalog version -> regression evaluation`

This loop is the OVERVA knowledge foundation. It improves recommendations without leaking one organization's data into another.
