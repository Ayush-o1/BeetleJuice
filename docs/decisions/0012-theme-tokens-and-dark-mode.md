# 0012 — Theme tokens and a dark theme

**Status:** accepted (v1.1.0). Extends [0010](0010-vanilla-frontend-design-system.md).

**Context.** v1.0.0 was light only, with a handful of colour literals outside the token file (focus ring, alert borders and inks,
skeleton shimmer, toast, danger hover). Operators work long sessions and many use a dark OS setting. The brief allowed a dark theme only if it could be done
properly.

**Decision.**
* Every colour is a token in `public/css/tokens.css`; components use `var(--…)` only. Each state colour has four tokens
  (foreground, background, border, ink) so alerts and badges keep their contrast in both themes. `--accent` (text, links, indicators) is separate from
  `--accent-solid` (filled buttons with white text), because one blue cannot satisfy both on a dark surface.
* Dark is a second block, `:root[data-theme='dark']`: blue-grey surfaces (`#101319` canvas, `#181C24` surface, `#1F2430` raised), never pure black; depth comes from
  lighter surfaces rather than shadows. Contrast was computed rather than eyeballed (every text pair ≥ 4.5:1 in both themes), and the axe test enforces it on every screen.
* Preference is `system` (default), `light` or `dark`, stored in `localStorage` (`bj.theme`). A small **classic** script, `/js/theme-init.js`, is loaded synchronously in `<head>` and writes the
  *resolved* theme to `<html data-theme>` before first paint, so there is no flash. It is an external file because the CSP forbids inline script. It also follows OS changes while the preference is `system`.
  CSS therefore needs one dark block, not a media-query copy plus an attribute copy.
* The toggle lives in a **Display** popover (native `popover` attribute: top layer, Esc, light dismiss, focus returns) that also holds row density, which previously looked like plain text in the top bar.

**Alternatives rejected.** A media-query-only dark theme (no user override). A theme toggle button with only a sun/moon icon (icon-only status; unclear with three states). Inline script
with a CSP hash (more moving parts than one tiny file). An animated cross-fade on switch (not needed; instant is calmer).

**Consequences.** Every new colour must be added to both blocks. Print and forced-colours modes were not specially designed (the product is a screen tool); `color-scheme` is set so native controls follow the theme.
