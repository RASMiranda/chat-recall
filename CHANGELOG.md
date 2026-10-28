# Changelog

## 0.1.2

- Fix: pasting into the search palette with the browser's right-click "Paste" no longer sends the text to claude.ai's message composer or closes the palette. Paste, typing and focus events from the palette are now stopped at its shadow host so claude.ai's page-level handlers never see them; the palette keeps focus on its input, and only a primary-button click on the backdrop closes it (a right-click no longer does). ([#7](https://github.com/RASMiranda/chat-recall/issues/7))
- New optional regression test: `scripts/paste-focus.test.js` (Playwright).

## 0.1.1

- Link to the Firefox add-on listing on AMO; store screenshots.

## 0.1.0

- First release.
