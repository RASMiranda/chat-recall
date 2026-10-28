# Publishing checklist

Everything below is unverified against the stores' current rules unless a source is named. Re-check each store's policy page before submitting.

## Before either store
1. Real-account test: load the unpacked build, open claude.ai, wait for indexing, search a word you know exists. Check **project scope** and **in-chat scope**.
2. Pick a final name and check it is not confusingly close to "Claude". The manifest name is "Chat Recall"; the description says "claude.ai" only to describe what it works with.
3. Privacy policy URL (no GitHub Pages needed): https://github.com/RASMiranda/chat-recall/blob/main/PRIVACY.md (the repo must be public).
4. The Firefox add-on id is `chat-recall@rasmiranda.github.io` (set in `scripts/build.js`). It is permanent once submitted.
5. Bump `version` in `package.json` for every submission.
6. Read Anthropic's terms regarding automated access to claude.ai before publishing; this extension uses undocumented endpoints.

## Releasing (automatic zips, no tags or tokens needed)
GitHub Actions (`.github/workflows/build.yml`) tests, builds, and lints on every push. When a push to `main` contains a `package.json` version that has no release yet, it creates a **draft** release `v<version>` with the Chrome, Firefox, and source zips attached.
1. Bump `version` in `package.json`, commit, push to `main`.
2. Open the repo's Actions tab and wait for the green run, then Releases: review the draft and publish it. Upload those zips to the stores.
- Re-pushes never touch an existing release (draft or published). To rebuild one, delete the draft and push again, or use Actions -> Run workflow with "release" ticked.
- Pushing a `v*` tag or ticking the box in Run workflow does the same thing.
- Publishing the draft creates the tag on GitHub.
- Every run also keeps the zips as a workflow artifact (Actions run page, kept for a limited time).

## Chrome Web Store
- Needs a developer account; I believe there is a one-time registration fee (not verified).
- Upload `dist/chat-recall-chrome-<version>.zip`.
- Privacy tab: single purpose = "search the user's claude.ai chat history locally". Data handled: website content (processed locally, not transmitted). Justify each permission: `storage`/`unlimitedStorage` for the local index; host access `https://claude.ai/*` to read chats and inject the search UI.
- Not using remote code: true (all code is in the package).

## Firefox (AMO)
- Listing: https://addons.mozilla.org/en-US/firefox/addon/chat-recall/
- Free developer account.
- Upload `dist/chat-recall-firefox-<version>.zip`. The manifest declares `data_collection_permissions: none` and a minimum Firefox of 140 (Android 142), matching `web-ext lint`.
- AMO may ask for the source: the build has no bundler or minification, so the zip is the source; also attach the repo.
- Reviewers will need a claude.ai account to test; say so in the reviewer notes.
- Version notes ("What's new") for 0.1.2: "Fixed: pasting into the search box with the right-click menu now works instead of going to the chat message box." Reviewer note: this only changes event handling in `src/content.js` (no new permissions).

## Donation link
<!-- donate-listing:start -->
Last line of the listing description: "Free and open source. If it helps you, you can support development: https://ko-fi.com/rasmiranda"
Platform notes: Chrome and Firefox stores each have their own rules about donation links and "contributions"; I have not verified either, so check them before submitting.
<!-- donate-listing:end -->

## Listing text (starting point)
**Name:** Chat Recall
**Summary (≤132 chars):** Instant local full-text search across all your claude.ai chats, per project or per chat. Private: nothing leaves your device.
**Description:** Press Ctrl/⌘+K on claude.ai to search every message in every chat, not just titles. Filter by project, by chat, by sender and by date; use "quotes" for phrases and -word to exclude. Each result shows the chat link with a Copy link button, and the page scrolls to the matching text. Everything is indexed and stored only in your browser. Unofficial: not affiliated with Anthropic.
