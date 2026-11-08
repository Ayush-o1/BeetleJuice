# Product audit of v1.0.0

Baseline: `main` at `3cf44c0` (tag `v1.0.0`). Method: ran the app against the demo database, signed in as each of the
three roles in Chrome at 1440, 820 and 390 px, took screenshots, walked the main journeys with the keyboard, ran
axe-core 4.x (WCAG 2.0/2.1/2.2 A + AA rules plus best-practice) over every view, and read the front-end and the
queries behind each screen. Status shows what became of each finding.

## What was already good (and is kept)

* Information architecture: Work / Data / Governance grouping, a break detail page that puts the finding, the two
  records side by side, the resolution form and the timeline on one screen.
* Financial typography: tabular figures, right-aligned amounts, Indian digit grouping, mono for identifiers.
* Colour is reserved for state; the accent is used for navigation and the primary action only.
* Server-side everything: permissions, CSRF, maker-checker and concurrency are not front-end concerns, so UI
  changes cannot weaken them.
* Real progress only: run state comes from the database; there is no invented percentage anywhere.

## Findings

Severity: **High** = wrong or blocks a task, **Med** = costs the user time or trust, **Low** = polish.

| # | Sev | Finding (observed) | Impact | Status |
|---|---|---|---|---|
| A1 | High | Review queue table is wider than its panel at 1440 px (scrollWidth 1218 vs 1142); the **Review** button column is clipped with no visible scroll cue. | A supervisor cannot see the primary action of the screen they exist for. | Fixed (M1) |
| A2 | High | axe `aria-required-children` (critical) on the run progress stepper. | Screen readers get a broken list structure for the one status display users rely on. | Fixed (M1) |
| A3 | Med | axe `color-contrast` (serious) on `--ink-3` secondary text over hovered/sunken rows, breadcrumbs, `.cell-sub`. | Fails WCAG 1.4.3 in places the design notes claimed 4.5:1. | Fixed (M1) |
| A4 | Med | Every clickable table row is `tabindex=0` **and** contains a link: two tab stops per row (50 stops for one page of breaks). | Keyboard users tab twice as far; the row stop announces nothing useful. | Fixed (M1) |
| A5 | Med | On a 390 px phone the break queue clips the Status and Amount columns; there is no stacked layout. | The triage screen is not usable on a phone. | Fixed (M1) |
| A6 | Low | Empty header cell in the review table (axe `empty-table-header`); "From run #1 ·" leaves a dangling separator on batch breaks. | Noise for assistive tech; looks unfinished. | Fixed (M1) |
| B1 | Med | Audit log shows raw action codes (`proposal.approved`), the raw username twice (username + role as sub-line) and a "Details" column that lists JSON key names (`proposalId, resolutionCode`). | An auditor has to open JSON to learn what happened. The log is the product's trust anchor and reads like a debug dump. | Fixed (M3) |
| B2 | Med | Login events dominate the top of the audit log; no way to hide authentication noise except choosing one family. | Hard to see business events. | Fixed (M3) |
| C1 | Med | After deciding a break, the user is returned to the same break and must go back to the queue and pick the next one. | Extra navigation for the most repeated action. | Fixed (M3) |
| C2 | Med | The break page says *what* fired (rule id and explanation) but not *what to check next*. New analysts have no guidance. | Slower investigation and inconsistent notes. | Fixed (M3) |
| C3 | Med | No way to ask "what happened to PAY-…?" for a reference that **matched**. The break queue only knows breaks, and customer-support questions are about arbitrary references. | The most common ad-hoc question has no answer in the product. | Fixed (M3) |
| D1 | Med | Overview has counts but nothing about **ageing** (how old are the open breaks?) or **recent activity**; "oldest unresolved" is a single number. | Operations leads manage breaks by age; one number hides the distribution. | Fixed (M3) |
| D2 | Low | A failed run is only surfaced on Overview when there is no completed run (`failed && !latestRun`). | A failure after a good run is invisible from the home page. | Fixed (M3) |
| E1 | Med | Upload: no byte progress for larger files, no downloadable template, and no explanation of what *validation* means before the user commits. | Users have to guess the format from a collapsed table. | Fixed (M3) |
| F1 | Med | Light theme only. The brief wants dark mode if it can be done well. | Long sessions, user preference, OS setting. | Done (M2) |
| F2 | Low | Density toggle is a ghost button that reads like static text ("Rows: comfortable"). | Looks like a label, not a control. | Fixed (M2, "Display" menu) |
| F3 | Low | Hard-coded colours outside tokens (`#4A63B8` focus, `#8D1C15`, alert borders/inks, shimmer gradient, toast ink). | Blocks theming; scattered values. | Fixed (M2) |
| G1 | Med | The generator produces **one** scenario of 330 rows. There is no small dataset, no clean day, no refund-heavy day, no large dataset other than the benchmark's private DB. | Hard to demo variety or to regression-test behaviours in isolation. | Fixed (M4) |
| G2 | Med | Browser tests cover one journey. No coverage for theme, filters + pagination, empty states, invalid upload through the UI, restricted actions per role, or accessibility. | UI regressions would ship. | Fixed (M5) |

## Looked at and deliberately **not** done

* **Run-to-run comparison.** Runs are frozen snapshots of one pair of files; two runs on the same files differ only by
  as-of date or settings. The break queue already filters by run. A diff view would be a new screen to maintain for a
  case the product rarely produces.
* **Charts beyond the existing bars.** The break-type bars and the new ageing bars are plain proportional bars with the
  numbers printed beside them. There is no time-series data worth plotting (one run is one point).
* **Saved filter presets.** Filters are already URL-addressable, which is shareable and bookmarkable. Server-side saved
  views would add a table, API and permissions for little gain.
* **Downloadable per-break investigation report.** The CSV export plus the audit export already carry this; a PDF
  generator would be a new dependency for a presentational gain.
* **Animations.** The product already has 120–180 ms transitions on view entry, dialogs and toasts, all disabled under
  `prefers-reduced-motion`. No new motion was added except the theme cross-fade, which is also disabled under reduced motion.
