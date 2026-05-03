import { CATEGORY_META } from "./rules.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
};

let snapshot = null;
let selected = new Set();
const collapsed = new Set(["pinned", "localOrPrivate"]);

function send(type, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...extra }, (resp) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (!resp || !resp.ok) return reject(new Error(resp?.error || "no response"));
      resolve(resp.data);
    });
  });
}

function fmtAge(ms) {
  if (!ms || ms < 0) return "";
  const m = ms / 60000;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h)}h`;
  const d = h / 24;
  return `${Math.round(d)}d`;
}

function setStatus(text) { $("#status").textContent = text || ""; }

function renderTabRow(tabId) {
  const entry = snapshot.byTabId[tabId];
  if (!entry) return null;
  const tab = entry.tab;
  const lastAccessed = tab.lastAccessed ? Date.now() - tab.lastAccessed : 0;
  const checked = selected.has(tabId);

  const cb = el("input", { type: "checkbox" });
  cb.checked = checked;
  cb.addEventListener("change", () => {
    if (cb.checked) selected.add(tabId);
    else selected.delete(tabId);
    updateCounts();
  });

  const fav = el("img", { class: "favicon", src: tab.favIconUrl || "" });
  fav.onerror = () => { fav.style.visibility = "hidden"; };

  const row = el(
    "div",
    { class: "tab-row" },
    cb,
    fav,
    el(
      "div",
      { class: "meta" },
      el("div", { class: "t-title", title: tab.title || "" }, tab.title || "(no title)"),
      el("div", { class: "t-url", title: tab.url || "" }, tab.url || "")
    ),
    el("div", { class: "age" }, fmtAge(lastAccessed)),
    el("button", { class: "x", title: "Close this tab" }, "✕")
  );

  // Click on meta -> activate tab
  row.querySelector(".meta").addEventListener("click", async () => {
    try { await send("activateTab", { tabId }); window.close(); } catch (e) { setStatus(String(e.message)); }
  });

  // X button -> close immediately
  row.querySelector(".x").addEventListener("click", async (e) => {
    e.stopPropagation();
    await send("closeTabs", { tabIds: [tabId] });
    await refresh();
  });

  return row;
}

function renderCategory(name, ids) {
  const meta = CATEGORY_META[name] || { label: name, color: "#868e96", action: "review" };
  const isCollapsed = collapsed.has(name);

  const head = el(
    "div",
    { class: "cat-head" },
    el(
      "div",
      { class: "left" },
      el("span", { class: "dot", style: `background:${meta.color}` }),
      el("strong", {}, meta.label),
      el("span", { class: "cat-count" }, String(ids.length))
    ),
    el(
      "div",
      { class: "cat-actions" },
      meta.action !== "skip"
        ? el("button", {
            onclick: async (e) => {
              e.stopPropagation();
              if (!ids.length) return;
              if (meta.action === "stash") {
                await send("stashTabs", { tabIds: ids });
                setStatus(`Stashed ${ids.length} from ${meta.label}`);
              } else {
                await send("closeTabs", { tabIds: ids });
                setStatus(`Closed ${ids.length} from ${meta.label}`);
              }
              await refresh();
            }
          }, meta.action === "stash" ? "Stash all" : "Close all")
        : null,
      el("button", {
        onclick: (e) => {
          e.stopPropagation();
          for (const id of ids) selected.add(id);
          updateCounts();
          renderAll();
        }
      }, "Select")
    )
  );

  head.addEventListener("click", () => {
    if (isCollapsed) collapsed.delete(name); else collapsed.add(name);
    renderAll();
  });

  const list = el("div", { class: "tab-list" });
  if (!isCollapsed) {
    for (const id of ids) {
      const row = renderTabRow(id);
      if (row) list.appendChild(row);
    }
  }

  return el("section", { class: "cat" }, head, list);
}

function updateCounts() {
  const total = Object.values(snapshot?.categories || {}).reduce((a, b) => a + b.length, 0);
  const sel = selected.size;
  $("#counts").textContent = sel > 0 ? `${total} · ${sel} sel` : `${total}`;
  const bar = $("#selectionBar");
  if (sel > 0) {
    bar.classList.remove("hidden");
    $("#selectionCount").textContent = `${sel} selected`;
  } else {
    bar.classList.add("hidden");
  }
}

function renderAll() {
  const root = $("#categories");
  root.innerHTML = "";

  // Order categories by priority for display.
  const order = [
    "duplicates",
    "searches",
    "youtubeIdle",
    "socialFeeds",
    "videoStreams",
    "authOrphans",
    "errorPages",
    "emptyTabs",
    "trackerLinks",
    "domainExplosion",
    "stale",
    "shopping",
    "articles",
    "docArticles",
    "forumThreads",
    "githubBrowse",
    "aiChats",
    "other",
    "localOrPrivate",
    "pinned"
  ];

  for (const name of order) {
    const ids = snapshot.categories[name] || [];
    if (!ids.length) continue;
    root.appendChild(renderCategory(name, ids));
  }
  updateCounts();
}

async function refresh() {
  setStatus("Scanning…");
  snapshot = await send("snapshot");
  // Drop selections for tabs that no longer exist.
  selected = new Set([...selected].filter((id) => snapshot.byTabId[id]));
  renderAll();
  setStatus("");
}

function fmtClock(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

async function openHistory() {
  const list = await send("getHistory");
  const panel = $("#historyPanel");
  const root = $("#historyList");
  root.innerHTML = "";
  if (!list.length) {
    root.appendChild(el("div", { class: "muted", style: "padding:12px" },
      "Nothing closed yet this session. Tabs you close via this extension will appear here until you quit the browser."));
  } else {
    for (const item of list) {
      const row = el(
        "div",
        { class: "stash-item" },
        el("div", { class: "meta" },
          el("div", { class: "t-title" }, item.title || "(untitled)"),
          el("div", { class: "t-url" }, item.url),
          el("div", { class: "age" }, fmtClock(item.closedAt))
        ),
        el("button", {
          onclick: async () => {
            await send("restoreHistory", { historyIds: [item.id] });
            await openHistory();
          }
        }, "Restore"),
        el("button", {
          class: "danger",
          onclick: async () => {
            await send("clearHistory", { historyIds: [item.id] });
            await openHistory();
          }
        }, "Forget")
      );
      root.appendChild(row);
    }
  }
  $("#stashPanel").classList.add("hidden");
  panel.classList.remove("hidden");
}

async function openStash() {
  const list = await send("getStash");
  const panel = $("#stashPanel");
  const root = $("#stashList");
  root.innerHTML = "";
  if (!list.length) {
    root.appendChild(el("div", { class: "muted", style: "padding:12px" }, "Stash is empty."));
  } else {
    for (const item of list) {
      const row = el(
        "div",
        { class: "stash-item" },
        el("div", { class: "meta" },
          el("div", { class: "t-title" }, item.title || "(untitled)"),
          el("div", { class: "t-url" }, item.url)
        ),
        el("button", {
          onclick: async () => {
            await send("restoreStash", { stashIds: [item.id] });
            await openStash();
          }
        }, "Restore"),
        el("button", {
          class: "danger",
          onclick: async () => {
            await send("clearStash", { stashIds: [item.id] });
            await openStash();
          }
        }, "Forget")
      );
      root.appendChild(row);
    }
  }
  $("#historyPanel").classList.add("hidden");
  panel.classList.remove("hidden");
}

async function actOnSelected(action) {
  const ids = [...selected].filter((id) => snapshot.byTabId[id]);
  if (!ids.length) return;
  // Strip protected ids defensively, even though Select shouldn't add them.
  const safe = ids.filter((id) => {
    const tags = snapshot.byTabId[id]?.tags || [];
    return !tags.includes("pinned") && !tags.includes("localOrPrivate");
  });
  if (action === "stash") {
    await send("stashTabs", { tabIds: safe });
    setStatus(`Stashed ${safe.length}`);
  } else {
    await send("closeTabs", { tabIds: safe });
    setStatus(`Closed ${safe.length}`);
  }
  selected.clear();
  await refresh();
}

document.addEventListener("DOMContentLoaded", async () => {
  $("#refreshBtn").addEventListener("click", refresh);
  $("#stashBtn").addEventListener("click", openStash);
  $("#historyBtn").addEventListener("click", openHistory);
  $("#optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#closeStashBtn").addEventListener("click", () => $("#stashPanel").classList.add("hidden"));
  $("#closeHistoryBtn").addEventListener("click", () => $("#historyPanel").classList.add("hidden"));
  $("#clearStashBtn").addEventListener("click", async () => {
    if (!confirm("Forget all stashed tabs?")) return;
    await send("clearStash", { stashIds: null });
    await openStash();
  });
  $("#clearHistoryBtn").addEventListener("click", async () => {
    await send("clearHistory", { historyIds: null });
    await openHistory();
  });
  $("#restoreAllHistoryBtn").addEventListener("click", async () => {
    const list = await send("getHistory");
    if (!list.length) return;
    await send("restoreHistory", { historyIds: list.map((h) => h.id) });
    await openHistory();
  });
  $("#selCloseBtn").addEventListener("click", () => actOnSelected("close"));
  $("#selStashBtn").addEventListener("click", () => actOnSelected("stash"));
  $("#selClearBtn").addEventListener("click", () => {
    selected.clear();
    renderAll();
  });
  await refresh();
});
