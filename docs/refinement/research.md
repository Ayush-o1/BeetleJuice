# Research notes for v1.1.0

What was read, what it changed, and what it did **not** change. Search results were summaries of vendor and standards pages; they were not
a usability study and nothing here is a claim about how any product performs. No branding, layout or copy was taken from any product.

## Reconciliation and exception-handling products

* **Modern Treasury**, reconciliation documentation and product journal
  ([exception handling and manual reconciliation](https://docs.moderntreasury.com/payments/docs/exception-handling-manual-reconciliation),
  [designing the new UI](https://moderntreasury.com/journal/behind-the-scenes-designing-our-new-ui),
  [complex reconciliation](https://moderntreasury.com/journal/expanding-support-for-complex-reconciliation),
  [automatic reconciliation](https://docs.moderntreasury.com/reconciliation/docs/automatic-reconciliation)).
  Points taken: when more than one expected payment fits a transaction it is **flagged for manual review instead of auto-matched**
  (BeetleJuice's R09 ambiguity guard already works this way, and the new `AMBIGUOUS_REFERENCE` guidance tells the analyst to pair by hand and record why);
  exceptions are triaged from a work queue next to the evidence, with the two sides shown together (kept: the break page's side-by-side
  comparison); an insights view of what remains unreconciled is the jumping-off point for exceptions (adopted in a smaller form: the ageing panel and
  recent activity on Overview, each linking into the filtered queue).
  **Not adopted:** suggested matches and AI-assisted reconciliation (excluded by the brief and unnecessary for a deterministic rule engine), one-to-many manual matching.
* Stripe, Adyen, Wise, Airwallex, Plaid and Ramp were named in the brief as references. Their reconciliation reports and dashboards are documented at a level that confirmed
  general patterns (itemised vs summary views, drill-down from a payout to its transactions, reason codes), all of which the v1.0.0 design already had. No specific decision
  in this release rests on a page from them, so none is cited as a source.

## Accessibility

* **W3C, What's New in WCAG 2.2** ([w3.org/WAI/standards-guidelines/wcag/new-in-22](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)) and secondary summaries
  ([Deque](https://dequeuniversity.com/resources/wcag-2.2), [WebAIM](https://webaim.org/standards/wcag/wcag22)). Two new AA criteria directly affect this product:
  **2.5.8 Target Size (Minimum)**, pointer targets about 24 × 24 CSS px unless spacing or another exception applies, and **2.4.11 Focus Not Obscured (Minimum)**, a focused item must not be entirely hidden by
  sticky content. Result: chip remove buttons (20 px), sort-header buttons (17 px tall) and the details summary were enlarged; `scroll-padding-top` keeps focus clear of the sticky top bar;
  both criteria are now automated tests (`test/e2e/accessibility.test.js`). The secondary sources disagree on how to classify some new criteria, so the W3C page was treated as authoritative.
* axe-core was added as a **dev** dependency to enforce contrast, name/role/value and landmark rules on every screen in both themes. It found real defects in v1.0.0 (run stepper structure, contrast of secondary text on hover, an
  empty table header) and in the new work (links distinguished only by colour, a login page without a main landmark).

## Tables and data density

* General data-table guidance from design write-ups ([Halo Lab](https://www.halo-lab.com/blog/the-ultimate-guide-to-designing-data-tables/), [SetProduct](https://www.setproduct.com/blog/data-table-ui-design),
  [Uxcel](https://uxcel.com/lessons/tables-best-practices-356)) agreed on: right-align numbers and use tabular figures (already done), keep headers visible, offer a density setting and remember it (done, now in the
  Display menu). GitLab Pajamas and IBM Carbon table guidance was **not** retrieved by the searches, so nothing is attributed to them.
* On phones the data-table sources did not settle one pattern; the labelled-card approach is a judgement ([ADR 0013](../decisions/0013-tables-as-cards-on-phones.md)).

## Dark theme

* **Material Design dark theme guidance** ([m2.material.io/design/color/dark-theme](https://m2.material.io/design/color/dark-theme)): avoid pure black, use a dark grey surface (the spec suggests `#121212`), express elevation with lighter surfaces rather than
  shadows, avoid very bright large surfaces, and use desaturated tones of the brand colour so text passes 4.5:1. Result: `#101319` / `#181C24` / `#1F2430` surfaces, a lighter accent for text and a separate solid accent for filled buttons, and **computed** contrast for every pair.
  The page gave no guidance on status colours, so green/amber/red variants were chosen and verified numerically instead ([ADR 0012](../decisions/0012-theme-tokens-and-dark-mode.md)).

## Not researched, and why

Motion guidance beyond `prefers-reduced-motion` (the product's animations are 120–180 ms and few; none were added), and financial-data formatting standards beyond what v1.0.0 already followed (integer paise, Indian digit grouping, true minus signs).
