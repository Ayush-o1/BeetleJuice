# 0010 — Vanilla-JS frontend and the visual system

**Status:** accepted.

**Research consulted** (web search results and vendor/design articles, read as summaries; not a usability study):
Stripe's payout reconciliation report documentation (payouts tied to the batch of transactions they settle, summary
vs itemised views, drill-down), Modern Treasury's write-up on designing its reconciliation UI, and several
reconciliation-UX and data-table design articles (work-queue + detail layout, simple status model, aged items,
reason codes and linked source records on a resolution, right-aligned tabular figures, density control, semantic
table markup). BeetleJuice copies no branding or layout from any of them.

**Decisions.**
* Vanilla ES modules, hash router, no build step: matches the author's stack and keeps the code readable. DOM is
  built with `createElement`/`textContent`; strict CSP forbids inline script/style.
* Queue → detail structure: a filterable break queue in the URL, and a detail page whose right column holds the
  resolution workflow, notes and timeline.
* Warm off-white canvas, white working surfaces, ink text, one indigo accent for action/navigation; green/amber/red
  only for state. IBM Plex Sans (text) and Mono (references), self-hosted (SIL OFL), tabular figures, Indian digit
  grouping, right-aligned amounts, true minus signs, IST labels. Figures as a ruled strip rather than cards.
* Every control performs an action, has a visible disabled/busy state, and consequential actions confirm in a native
  `<dialog>`. Reduced motion is respected; the only animations are a 160 ms view fade, a badge pulse while running
  and a one-off ring when a run completes.

**Consequences.** No component library to learn or audit; more hand-written CSS and no automated visual regression.
