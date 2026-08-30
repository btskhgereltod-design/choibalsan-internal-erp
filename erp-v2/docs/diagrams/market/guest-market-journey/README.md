# OVERVA Market Guest Journey

Status: `TO-BE draft` for human review  
Language: Mongolian / English  
Version: `v1`  
Created: `2026-08-30`

## Files

- `guest-market-journey.mmd` — canonical editable Mermaid source.
- `guest-market-journey.svg` — canonical scalable review image for browsers, Word, PowerPoint and Visio import.
- `guest-market-journey.bpmn` — editable BPMN 2.0 XML for BPMN-compatible modeling tools.
- `guest-market-journey.vsdx` — create only by opening the SVG or BPMN source in Microsoft Visio and using **Save As → Visio Drawing (.vsdx)**. It is intentionally not fabricated when Visio is unavailable.

## Canonical editing rule

This folder keeps one canonical Guest Market Journey. Small visual or logic revisions must update `guest-market-journey.mmd` and regenerate `guest-market-journey.svg` in place. Do not create `v2`, `final`, `copy`, dated, or duplicate image files for the same journey. Git history preserves previous revisions. A new folder is created only for a genuinely different business process.

## Status colors

- Gray — not planned.
- Gold — planned.
- Blue — in progress.
- Green — implemented.
- Purple — verified.
- Red — blocked.
- Orange — decision required.

Color always represents the process node's current implementation status. Arrow color does not represent status; arrows only show flow. Every diagram must contain its own status legend. A business idea that is approved but not coded remains gold. Revenue points are identified by `ОРЛОГО / REVENUE` text rather than a separate status color.

## Revenue hypotheses

- Request posting fee: `20,000₮` per published request.
- Storefront subscription: `200,000₮` per month.
- Developer seat: price to be validated.

## Scope

This is a proposed target journey. It must not be interpreted as fully implemented product behavior, a production commitment, or a confirmed commercial contract.

## Visio export

Microsoft Visio is not installed on the computer that generated this package. To create the real `.vsdx` file later:

1. Open Microsoft Visio.
2. Import `guest-market-journey.svg`, or open/import `guest-market-journey.bpmn` with a BPMN-compatible Visio workflow.
3. Review the layout and BPMN semantics.
4. Save as `guest-market-journey.vsdx` in this folder.

Do not rename another format to `.vsdx`; that would create an invalid Visio file.
