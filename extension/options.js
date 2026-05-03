import { DEFAULT_SETTINGS } from "./rules.js";

const KEY = "settings";
const $ = (id) => document.getElementById(id);

async function load() {
  const got = await chrome.storage.sync.get(KEY);
  const s = { ...DEFAULT_SETTINGS, ...(got[KEY] || {}) };
  $("pinPatterns").value = (s.pinPatterns || []).join("\n");
  $("staleHours").value = s.staleHours;
  $("youtubeIdleHours").value = s.youtubeIdleHours;
  $("sameDomainExplosionThreshold").value = s.sameDomainExplosionThreshold;
}

async function save() {
  const s = {
    pinPatterns: $("pinPatterns").value
      .split("\n").map((x) => x.trim()).filter(Boolean),
    staleHours: +$("staleHours").value || DEFAULT_SETTINGS.staleHours,
    youtubeIdleHours: +$("youtubeIdleHours").value || DEFAULT_SETTINGS.youtubeIdleHours,
    sameDomainExplosionThreshold:
      +$("sameDomainExplosionThreshold").value || DEFAULT_SETTINGS.sameDomainExplosionThreshold
  };
  await chrome.storage.sync.set({ [KEY]: s });
  $("saved").textContent = "Saved";
  setTimeout(() => ($("saved").textContent = ""), 1500);
}

async function reset() {
  await chrome.storage.sync.set({ [KEY]: DEFAULT_SETTINGS });
  await load();
  $("saved").textContent = "Reset";
  setTimeout(() => ($("saved").textContent = ""), 1500);
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("saveBtn").addEventListener("click", save);
  $("resetBtn").addEventListener("click", reset);
});
