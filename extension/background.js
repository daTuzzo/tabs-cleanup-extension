// Service worker. Handles messages from the popup and owns the stash and
// session-history storage so the popup can close cleanly.

import { categorize, DEFAULT_SETTINGS } from "./rules.js";

const STASH_KEY = "stash";
const SETTINGS_KEY = "settings";
const HISTORY_KEY = "history";
const HISTORY_CAP = 200;

async function getSettings() {
  const got = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(got[SETTINGS_KEY] || {}) };
}

async function getStash() {
  const got = await chrome.storage.local.get(STASH_KEY);
  return got[STASH_KEY] || [];
}

async function setStash(stash) {
  await chrome.storage.local.set({ [STASH_KEY]: stash });
}

async function listAllTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs;
}

async function snapshotAndCategorize() {
  const [tabs, settings] = await Promise.all([listAllTabs(), getSettings()]);
  const result = categorize(tabs, settings);
  return { tabs, ...result, settings };
}

async function stashTabs(tabIds) {
  const stash = await getStash();
  const tabs = await chrome.tabs.query({});
  const tabMap = new Map(tabs.map((t) => [t.id, t]));
  const ts = Date.now();
  const added = [];
  for (const id of tabIds) {
    const t = tabMap.get(id);
    if (!t) continue;
    added.push({
      id: `${ts}-${id}`,
      stashedAt: ts,
      title: t.title,
      url: t.url,
      favIconUrl: t.favIconUrl
    });
  }
  stash.unshift(...added);
  // Cap stash to 500 entries to avoid runaway storage.
  await setStash(stash.slice(0, 500));
  await chrome.tabs.remove(tabIds);
  return added.length;
}

// Session-only history: wiped when the browser closes.
async function getHistory() {
  const got = await chrome.storage.session.get(HISTORY_KEY);
  return got[HISTORY_KEY] || [];
}

async function setHistory(history) {
  await chrome.storage.session.set({ [HISTORY_KEY]: history });
}

async function recordHistory(tabIds) {
  const tabs = await chrome.tabs.query({});
  const tabMap = new Map(tabs.map((t) => [t.id, t]));
  const now = Date.now();
  const entries = [];
  for (const id of tabIds) {
    const t = tabMap.get(id);
    if (!t || !t.url) continue;
    if (t.url.startsWith("chrome://") || t.url.startsWith("about:")) continue;
    entries.push({
      id: `h-${now}-${id}`,
      closedAt: now,
      title: t.title,
      url: t.url,
      favIconUrl: t.favIconUrl
    });
  }
  if (!entries.length) return;
  const history = await getHistory();
  history.unshift(...entries);
  await setHistory(history.slice(0, HISTORY_CAP));
}

async function closeTabs(tabIds) {
  if (!tabIds.length) return 0;
  await recordHistory(tabIds);
  await chrome.tabs.remove(tabIds);
  return tabIds.length;
}

async function restoreHistory(historyIds) {
  const history = await getHistory();
  const keep = [];
  let restored = 0;
  for (const item of history) {
    if (historyIds.includes(item.id)) {
      await chrome.tabs.create({ url: item.url, active: false });
      restored++;
    } else {
      keep.push(item);
    }
  }
  await setHistory(keep);
  return restored;
}

async function clearHistory(historyIds) {
  if (!historyIds || !historyIds.length) {
    await setHistory([]);
    return 0;
  }
  const history = await getHistory();
  const keep = history.filter((h) => !historyIds.includes(h.id));
  await setHistory(keep);
  return history.length - keep.length;
}

async function restoreStash(stashIds) {
  const stash = await getStash();
  const keep = [];
  let restored = 0;
  for (const item of stash) {
    if (stashIds.includes(item.id)) {
      await chrome.tabs.create({ url: item.url, active: false });
      restored++;
    } else {
      keep.push(item);
    }
  }
  await setStash(keep);
  return restored;
}

async function clearStash(stashIds) {
  if (!stashIds || !stashIds.length) {
    await setStash([]);
    return 0;
  }
  const stash = await getStash();
  const keep = stash.filter((s) => !stashIds.includes(s.id));
  await setStash(keep);
  return stash.length - keep.length;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "snapshot": {
          sendResponse({ ok: true, data: await snapshotAndCategorize() });
          break;
        }
        case "stashTabs": {
          sendResponse({ ok: true, data: await stashTabs(msg.tabIds) });
          break;
        }
        case "closeTabs": {
          sendResponse({ ok: true, data: await closeTabs(msg.tabIds) });
          break;
        }
        case "getStash": {
          sendResponse({ ok: true, data: await getStash() });
          break;
        }
        case "restoreStash": {
          sendResponse({ ok: true, data: await restoreStash(msg.stashIds) });
          break;
        }
        case "clearStash": {
          sendResponse({ ok: true, data: await clearStash(msg.stashIds) });
          break;
        }
        case "getHistory": {
          sendResponse({ ok: true, data: await getHistory() });
          break;
        }
        case "restoreHistory": {
          sendResponse({ ok: true, data: await restoreHistory(msg.historyIds) });
          break;
        }
        case "clearHistory": {
          sendResponse({ ok: true, data: await clearHistory(msg.historyIds) });
          break;
        }
        case "activateTab": {
          await chrome.tabs.update(msg.tabId, { active: true });
          const t = await chrome.tabs.get(msg.tabId);
          await chrome.windows.update(t.windowId, { focused: true });
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: `unknown type: ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // keep channel open for async sendResponse
});
