// Shared categorization engine. Pure functions, no chrome.* calls.
// Input: array of tab objects (from chrome.tabs.query) + settings.
// Output: { categories: { [name]: [tabId,...] }, byTabId: { [id]: { tab, tags: [] } } }

export const DEFAULT_SETTINGS = {
  pinPatterns: [
    "https://claude.ai/*",
    "http://localhost*",
    "http://127.0.0.1*",
    "*.ts.net*",
    "https://github.com/*/issues/*",
    "https://github.com/*/pull/*"
  ],
  staleHours: 48,
  youtubeIdleHours: 6,
  sameDomainExplosionThreshold: 6
};

const SEARCH_HOSTS = new Set([
  "www.google.com", "google.com",
  "www.bing.com", "bing.com",
  "duckduckgo.com",
  "search.brave.com",
  "www.startpage.com",
  "www.ecosia.org",
  "yandex.com", "www.yandex.com"
]);

const SOCIAL_FEED_PATTERNS = [
  /^https:\/\/(www\.)?x\.com\/?(home)?$/,
  /^https:\/\/(www\.)?twitter\.com\/?(home)?$/,
  /^https:\/\/(www\.)?facebook\.com\/?$/,
  /^https:\/\/(www\.)?instagram\.com\/?$/,
  /^https:\/\/(www\.)?reddit\.com\/?$/,
  /^https:\/\/(www\.)?reddit\.com\/r\/[^/]+\/?$/,
  /^https:\/\/(www\.)?tiktok\.com\/foryou/,
  /^https:\/\/(www\.)?linkedin\.com\/feed\/?$/
];

const AI_CHAT_HOSTS = new Set([
  "chatgpt.com", "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "perplexity.ai", "www.perplexity.ai",
  "poe.com",
  "huggingface.co"
]);

const DOC_HOSTS = new Set([
  "developer.mozilla.org",
  "stackoverflow.com", "stackexchange.com",
  "docs.python.org", "nodejs.org", "react.dev", "vuejs.org", "svelte.dev",
  "tailwindcss.com", "getbootstrap.com",
  "developer.chrome.com", "learn.microsoft.com",
  "docs.github.com", "docs.npmjs.com",
  "pkg.go.dev", "doc.rust-lang.org", "rust-lang.github.io",
  "kubernetes.io", "docs.docker.com",
  "developer.apple.com", "developer.android.com",
  "wikipedia.org", "en.wikipedia.org",
  "docs.anthropic.com", "platform.openai.com"
]);

const ARTICLE_HOSTS = new Set([
  "medium.com", "substack.com",
  "dev.to", "hashnode.com", "hashnode.dev",
  "news.ycombinator.com", "lobste.rs",
  "techcrunch.com", "theverge.com", "arstechnica.com", "wired.com",
  "nytimes.com", "wsj.com", "bbc.com", "bbc.co.uk", "theguardian.com",
  "bloomberg.com", "ft.com", "reuters.com",
  "smashingmagazine.com", "css-tricks.com", "freecodecamp.org"
]);

const SHOPPING_HOST_PATTERNS = [
  /(^|\.)amazon\.[a-z.]+$/, /(^|\.)ebay\.[a-z.]+$/,
  /(^|\.)aliexpress\.[a-z.]+$/, /(^|\.)alibaba\.com$/,
  /(^|\.)etsy\.com$/, /(^|\.)walmart\.com$/, /(^|\.)temu\.com$/,
  /(^|\.)olx\.[a-z.]+$/, /(^|\.)ozon\.[a-z.]+$/,
  /(^|\.)bazar\.bg$/, /(^|\.)emag\.[a-z.]+$/
];

const VIDEO_STREAM_HOSTS = new Set([
  "www.netflix.com", "netflix.com",
  "www.twitch.tv", "twitch.tv",
  "vimeo.com", "www.vimeo.com",
  "www.dailymotion.com", "dailymotion.com",
  "www.disneyplus.com", "disneyplus.com",
  "www.hulu.com", "hulu.com"
]);

function patternToRegex(pat) {
  // Glob: * matches anything. Anchored at both ends.
  const escaped = pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$", "i");
}

function safeUrl(u) {
  try { return new URL(u); } catch { return null; }
}

function isLocalOrTailscale(url) {
  if (!url) return false;
  const h = url.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return true;
  if (h.endsWith(".ts.net") || h.endsWith(".local")) return true;
  // 100.64.0.0/10 (Tailscale CGNAT)
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function isSearchPage(url) {
  if (!url) return false;
  if (!SEARCH_HOSTS.has(url.hostname)) return false;
  // Google: /search?q=... ; DDG: /?q=... ; Bing: /search?q=...
  if (url.pathname === "/search" && url.searchParams.has("q")) return true;
  if (url.hostname.includes("duckduckgo") && url.searchParams.has("q")) return true;
  return false;
}

function isYouTubeWatch(url) {
  if (!url) return false;
  if (!url.hostname.match(/(^|\.)youtube\.com$/) && url.hostname !== "youtu.be") return false;
  if (url.hostname === "youtu.be") return true;
  return url.pathname === "/watch" || url.pathname.startsWith("/shorts/");
}

function isAuthRedirect(url) {
  if (!url) return false;
  const s = url.pathname.toLowerCase() + " " + url.search.toLowerCase();
  return /(\boauth\b|\/auth\/callback|\/login\/callback|\/sso\/|sign[_-]?in)/.test(s);
}

function isSocialFeed(rawUrl) {
  return SOCIAL_FEED_PATTERNS.some((re) => re.test(rawUrl));
}

function isEmptyOrNewTab(rawUrl) {
  return (
    !rawUrl ||
    rawUrl === "about:blank" ||
    rawUrl.startsWith("chrome://newtab") ||
    rawUrl.startsWith("edge://newtab") ||
    rawUrl.startsWith("opera://startpage") ||
    rawUrl === "chrome://new-tab-page/"
  );
}

function isErrorPage(tab) {
  if (!tab.url) return false;
  if (tab.url.startsWith("chrome-error://")) return true;
  if (tab.title && /can.?t be reached|no internet|err_|404/i.test(tab.title)) return true;
  return false;
}

function isTrackerHeavy(url) {
  if (!url) return false;
  let utm = 0;
  for (const k of url.searchParams.keys()) {
    if (k.startsWith("utm_") || k === "fbclid" || k === "gclid" || k === "mc_cid") utm++;
  }
  return utm >= 2 || url.search.length > 400;
}

function isArticleHost(url) {
  if (!url) return false;
  if (ARTICLE_HOSTS.has(url.hostname)) return true;
  if (url.hostname.endsWith(".medium.com")) return true;
  if (url.hostname.endsWith(".substack.com")) return true;
  return false;
}

function isArticleShape(url) {
  if (!url) return false;
  const h = url.hostname;
  const p = url.pathname;
  // Subdomain blogs: blog.foo.com, news.foo.com
  if (/^(blog|news|engineering|eng|tech)\./.test(h)) return true;
  // Path patterns
  if (/^\/(blog|news|article|articles|posts?|stories|writing)\//.test(p)) return true;
  // Date-shaped slugs: /2024/03/title or /2024-03-title
  if (/^\/\d{4}\/\d{1,2}\//.test(p)) return true;
  return false;
}

function isShoppingHost(url) {
  if (!url) return false;
  return SHOPPING_HOST_PATTERNS.some((re) => re.test(url.hostname));
}

function isVideoStream(url) {
  if (!url) return false;
  return VIDEO_STREAM_HOSTS.has(url.hostname);
}

function isGitHubBrowse(url) {
  if (!url) return false;
  if (!/^(www\.)?github\.com$/.test(url.hostname)) return false;
  // Issues / PRs are pinnable per default settings; everything else (repo browse,
  // file view, gists, search) is generic browsing.
  if (/\/(issues|pull|pulls)\//.test(url.pathname)) return false;
  if (url.pathname === "/" || url.pathname === "/notifications") return false;
  return true;
}

function isForumThread(rawUrl) {
  if (!rawUrl) return false;
  if (/reddit\.com\/r\/[^/]+\/comments\//.test(rawUrl)) return true;
  if (/news\.ycombinator\.com\/item\?id=/.test(rawUrl)) return true;
  if (/lobste\.rs\/s\//.test(rawUrl)) return true;
  return false;
}

export function categorize(tabs, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const pinRegexes = (s.pinPatterns || []).map(patternToRegex);
  const now = Date.now();
  const staleMs = s.staleHours * 3600 * 1000;
  const ytIdleMs = s.youtubeIdleHours * 3600 * 1000;

  const byTabId = {};
  const categories = {
    pinned: [],
    duplicates: [],
    searches: [],
    youtubeIdle: [],
    localOrPrivate: [],
    socialFeeds: [],
    videoStreams: [],
    shopping: [],
    aiChats: [],
    authOrphans: [],
    errorPages: [],
    emptyTabs: [],
    trackerLinks: [],
    stale: [],
    docArticles: [],
    articles: [],
    githubBrowse: [],
    forumThreads: [],
    domainExplosion: [],
    other: []
  };

  // First pass: tag every tab.
  for (const tab of tabs) {
    const url = safeUrl(tab.url);
    const tags = [];
    const lastAccessedMs = tab.lastAccessed ? now - tab.lastAccessed : 0;

    // Pinned check first; pinned tabs short-circuit (still get other tags for visibility but won't be closed by default).
    const isPinned =
      tab.pinned ||
      (tab.url && pinRegexes.some((re) => re.test(tab.url))) ||
      (url && isLocalOrTailscale(url));

    if (isPinned) tags.push("pinned");
    if (url && isLocalOrTailscale(url)) tags.push("localOrPrivate");
    if (isEmptyOrNewTab(tab.url)) tags.push("emptyTabs");
    if (isErrorPage(tab)) tags.push("errorPages");
    if (url && isSearchPage(url)) tags.push("searches");
    if (url && isYouTubeWatch(url) && lastAccessedMs > ytIdleMs) tags.push("youtubeIdle");
    if (url && isAuthRedirect(url) && !tab.active) tags.push("authOrphans");
    if (tab.url && isSocialFeed(tab.url)) tags.push("socialFeeds");
    if (url && AI_CHAT_HOSTS.has(url.hostname)) tags.push("aiChats");
    if (url && isTrackerHeavy(url)) tags.push("trackerLinks");
    if (url && DOC_HOSTS.has(url.hostname)) tags.push("docArticles");
    if (url && (isArticleHost(url) || isArticleShape(url))) tags.push("articles");
    if (url && isShoppingHost(url)) tags.push("shopping");
    if (url && isVideoStream(url)) tags.push("videoStreams");
    if (url && isGitHubBrowse(url)) tags.push("githubBrowse");
    if (tab.url && isForumThread(tab.url)) tags.push("forumThreads");
    if (lastAccessedMs > staleMs && !isPinned && !tab.active && !tab.audible) {
      tags.push("stale");
    }

    byTabId[tab.id] = { tab, tags };
  }

  // Duplicate detection (exact URL match, ignoring fragment).
  const urlMap = new Map();
  for (const tab of tabs) {
    if (!tab.url) continue;
    const key = tab.url.split("#")[0];
    if (!urlMap.has(key)) urlMap.set(key, []);
    urlMap.get(key).push(tab);
  }
  for (const group of urlMap.values()) {
    if (group.length < 2) continue;
    // Keep the most recently accessed; tag the rest as duplicates.
    group.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    for (let i = 1; i < group.length; i++) {
      const t = group[i];
      if (!byTabId[t.id].tags.includes("pinned")) {
        byTabId[t.id].tags.push("duplicates");
      }
    }
  }

  // Same-domain explosion.
  const domainCounts = new Map();
  for (const tab of tabs) {
    const url = safeUrl(tab.url);
    if (!url) continue;
    domainCounts.set(url.hostname, (domainCounts.get(url.hostname) || 0) + 1);
  }
  for (const tab of tabs) {
    const url = safeUrl(tab.url);
    if (!url) continue;
    if ((domainCounts.get(url.hostname) || 0) >= s.sameDomainExplosionThreshold) {
      if (!byTabId[tab.id].tags.includes("pinned")) {
        byTabId[tab.id].tags.push("domainExplosion");
      }
    }
  }

  // Bucket into categories. Each tab goes into its most "actionable" category;
  // pinned overrides everything actionable.
  const priority = [
    "pinned",
    "errorPages",
    "emptyTabs",
    "duplicates",
    "authOrphans",
    "trackerLinks",
    "searches",
    "youtubeIdle",
    "socialFeeds",
    "videoStreams",
    "shopping",
    "domainExplosion",
    "stale",
    "forumThreads",
    "articles",
    "docArticles",
    "githubBrowse",
    "aiChats",
    "localOrPrivate"
  ];

  for (const tabId of Object.keys(byTabId)) {
    const { tags } = byTabId[tabId];
    let placed = false;
    for (const p of priority) {
      if (tags.includes(p)) {
        categories[p].push(+tabId);
        placed = true;
        break;
      }
    }
    if (!placed) categories.other.push(+tabId);
  }

  return { categories, byTabId };
}

export const CATEGORY_META = {
  pinned: { label: "Pinned / protected", color: "#7c5cff", action: "skip" },
  duplicates: { label: "Duplicates", color: "#ff6b6b", action: "close" },
  searches: { label: "Search result pages", color: "#ffa94d", action: "close" },
  youtubeIdle: { label: "YouTube (idle)", color: "#ff6b6b", action: "close" },
  socialFeeds: { label: "Social media feeds", color: "#ffa94d", action: "close" },
  videoStreams: { label: "Video streaming", color: "#ffa94d", action: "review" },
  shopping: { label: "Shopping pages", color: "#ffa94d", action: "stash" },
  authOrphans: { label: "Auth/SSO orphans", color: "#ff6b6b", action: "close" },
  errorPages: { label: "Error pages", color: "#ff6b6b", action: "close" },
  emptyTabs: { label: "Empty / new tab", color: "#ff6b6b", action: "close" },
  trackerLinks: { label: "Tracker-heavy URLs", color: "#ffa94d", action: "review" },
  domainExplosion: { label: "Same-domain pile-up", color: "#ffd43b", action: "review" },
  stale: { label: "Stale (not used recently)", color: "#ffd43b", action: "stash" },
  docArticles: { label: "Docs (read later?)", color: "#74c0fc", action: "stash" },
  articles: { label: "Articles / blog posts", color: "#74c0fc", action: "stash" },
  githubBrowse: { label: "GitHub browsing", color: "#74c0fc", action: "review" },
  forumThreads: { label: "Forum threads (Reddit, HN)", color: "#74c0fc", action: "stash" },
  aiChats: { label: "AI chat tabs", color: "#74c0fc", action: "review" },
  localOrPrivate: { label: "Localhost / Tailscale", color: "#7c5cff", action: "skip" },
  other: { label: "Other", color: "#868e96", action: "review" }
};
