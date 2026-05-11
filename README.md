# Tabs Cleanup

Chrome/Opera extension for managing a chaotic set of open tabs. Categorizes them (duplicates, search pages, idle YouTube, stale, localhost, articles, shopping, GitHub browsing, forum threads, …), and lets you stash or close in bulk. Soft-stash persists across browser restarts; close-history persists only until the browser quits.

Local-only. No telemetry. No network calls. MIT licensed.

## Install

1. Open `chrome://extensions` (or `opera://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → `extension/`.
4. Pin the action.

Same install in Chrome and Opera.

## What gets categorized

- **Duplicates** — same URL ignoring fragment; keeps the most recently used
- **Search result pages** — Google / Bing / DDG / Brave / Startpage / Yandex / Ecosia
- **YouTube (idle)** — watch pages older than threshold
- **Social feeds** — X, Reddit, FB, IG, TikTok, LinkedIn root feeds
- **Video streaming** — Netflix, Twitch, Vimeo, Hulu, Disney+
- **Shopping** — Amazon, eBay, Etsy, AliExpress, Temu, eMag, OLX, Bazar.bg, Ozon
- **Auth / SSO orphans** — leftover OAuth/login redirects
- **Error pages** / **Empty / new tab**
- **Tracker-heavy URLs** — multiple `utm_*` / `fbclid` / `gclid`, or huge query strings
- **Same-domain pile-up** — N+ tabs from one host
- **Stale** — not focused for N hours
- **Articles** — Medium, Substack, dev.to, news sites, blog/news subdomains, date-shaped slugs
- **Docs** — MDN, Stack Overflow, Python, Node, React, Tailwind, MS Learn, Anthropic, OpenAI, etc.
- **GitHub browsing** — repo / file / search pages (issues & PRs are pinnable separately)
- **Forum threads** — Reddit `/comments/`, HN items, Lobsters
- **AI chats** — chatgpt, claude.ai, gemini, perplexity, poe, huggingface
- **Localhost / Tailscale** — auto-pinned, never closed
- **Pinned** — your custom glob list, plus actually pinned tabs

## Stash vs History

- **Stash** — soft-delete via the **Stash all** action on a category, or via the per-category bulk button. Persists in `chrome.storage.local` across restarts. Capped at 500 entries. Restore individually or clear all.
- **History** — every tab closed via this extension goes here. Lives in `chrome.storage.session`, so it's wiped when the browser process exits. Capped at 200 entries.

The per-row **✕** and "Close all" on aggressive categories hard-close — those still get recorded in History so you can undo within the session.

## Settings

Right-click the icon → **Options**, or click the gear in the popup.

- **Pin patterns** — glob list, one per line. Examples:
  ```
  https://claude.ai/*
  http://localhost*
  *.ts.net*
  https://github.com/*/issues/*
  ```
- **Stale threshold** (default 48h)
- **YouTube idle threshold** (default 6h)
- **Same-domain pile-up threshold** (default 6)

## Layout

```
extension/        - the MV3 extension (load unpacked)
scripts/          - dev helpers (regenerate icons, etc.)
```

## Re-generate icons

```
node scripts/make-icons.js
```
Writes 16/32/48/128 PNGs into `extension/icons/`.
