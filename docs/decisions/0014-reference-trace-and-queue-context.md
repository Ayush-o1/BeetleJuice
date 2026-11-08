# 0014 — Find-a-reference lookup, and queue context on the break page

**Status:** accepted (v1.1.0).

**Problem.** Support and operations questions are about *a reference* ("did PAY-… settle?"), usually one that **matched**. The break queue only knows breaks.
Separately, working a queue meant opening a break, acting, going back and finding the next one.

**Decisions.**
* `GET /api/trace?reference=` returns every ledger entry and settlement line carrying a reference and how each *completed* run classified them. It reads existing tables only (no new data),
  uses exact upper-cased matching (the parsers store references upper-cased), and is open to all roles because it exposes nothing the break and run pages do not. Migration 0006 adds three
  btree indexes because the existing `(source_file_id, reference)` indexes cannot serve a lookup that does not know the file. Planner use of the index is tested.
  Fuzzy search was **not** added: it would blur the "a mistyped reference is two breaks" rule the engine is built on.
* The top bar has a search box (`/` focuses it). Results are a page of their own so they are linkable.
* The break list remembers (in `sessionStorage`, this tab only) the ids on the page the user came from and the exact filtered URL. The break page then offers Previous/Next (and `[` / `]`) and a breadcrumb that
  returns to the same filters. Opening a break directly shows no queue controls: it never invents a queue. Only the current page of results (≤ 25) is navigable; saying "of 25" is honest, a hidden 100-id prefetch would not be.
* "What to check" guidance per break type is **static, reviewed text** that says where to look and which resolutions usually apply. It never restricts the resolution list and is not presented as a recommendation engine.

**Rejected.** A global full-text search; server-side saved views; a "next unassigned break" assignment system (needs ownership rules the product does not have).
