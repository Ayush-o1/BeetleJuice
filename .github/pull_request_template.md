## What and why

<!-- The problem this solves, in a sentence or two. Link the issue if there is one. -->

## Checklist

- [ ] `npm run lint && npm test` pass locally (browser tests need Chrome)
- [ ] Behaviour changes have tests in the same change; no test weakened or skipped to get green
- [ ] Money stays integer paise; any new financial rule has a boundary test
- [ ] UI changes checked in light **and** dark, at desktop and phone width; new route added to the axe screen list
- [ ] Schema changes are a new migration (applied ones are never edited)
- [ ] Docs updated (README, `docs/`, CHANGELOG) where behaviour or commands changed
- [ ] No secrets, personal data or real financial data in the diff
