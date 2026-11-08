# 0013 — Tables become labelled cards on phones

**Status:** accepted (v1.1.0).

**Context.** The break queue, sources and review tables clipped columns on a 390 px screen (the status and amount, the two things a triager needs, were off-screen). v1.0.0 only hid secondary columns.
Horizontal scrolling is a poor triage experience; a separate mobile layout would duplicate every table.

**Decision.** `dataTable()` renders a normal semantic `<table>` with explicit ARIA roles (`table`, `rowgroup`, `row`, `columnheader`, `cell`) and puts each column's header text on its cell as `data-label`.
Below 640 px CSS switches the elements to `display: block/flex`: the header row is visually hidden (still present for assistive technology), the first column becomes the card title and each other cell shows
`label … value`. Columns marked `hideSm` stay hidden on phones to keep cards short. No JavaScript changes between layouts.

**Why the explicit roles.** Changing `display` on table elements makes some browsers drop their table semantics; the roles restore them.

**Rejected.** Horizontal scroll with a sticky first column (keeps density but hides state); a second card-rendering code path (two things to keep in sync); a JS breakpoint switch.

**Consequences.** One place to change table behaviour; a table that needs a real grid on phones (none today) can opt out with `stack: false`. Tested at 390 px by the axe and reflow tests.
