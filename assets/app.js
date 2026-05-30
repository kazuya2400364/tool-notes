const DATA_URL = "data/items.json";

const CATEGORY_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Gemini",
  cursor: "Cursor",
  notion: "Notion",
  databricks: "Databricks",
};

const CATEGORY_ICONS = {
  all: { label: "All", glyph: "all" },
  openai: { label: "OpenAI", glyph: "ai" },
  anthropic: { label: "Anthropic", icon: "https://cdn.simpleicons.org/anthropic/111111" },
  google: { label: "Gemini", icon: "https://cdn.simpleicons.org/googlegemini/4A5568" },
  cursor: { label: "Cursor", icon: "https://cdn.simpleicons.org/cursor/111111" },
  notion: { label: "Notion", icon: "https://cdn.simpleicons.org/notion/111111" },
  databricks: { label: "Databricks", icon: "https://cdn.simpleicons.org/databricks/FF3621" },
};

const TYPE_LABELS = {
  usecase: "Use cases",
  tips: "Tips",
  tutorial: "Tutorial",
  workflow: "Workflow",
  video: "Video",
  article: "Article",
  official: "Official",
  release: "Release",
};

const SOURCE_LABELS = {
  zenn: "Zenn",
  qiita: "Qiita",
  note: "note",
  reddit: "Reddit",
  hn: "HN",
  devto: "dev.to",
  youtube: "YouTube",
  blog: "Blog",
  other: "Other",
};

const SOURCE_ICONS = {
  all: { label: "All sources", glyph: "all" },
  zenn: { label: "Zenn", icon: "https://cdn.simpleicons.org/zenn/3EA8FF" },
  qiita: { label: "Qiita", icon: "https://cdn.simpleicons.org/qiita/55C500" },
  note: { label: "note", icon: "https://cdn.simpleicons.org/note/41C9B4" },
  reddit: { label: "Reddit", icon: "https://cdn.simpleicons.org/reddit/FF4500" },
  hn: { label: "Hacker News", icon: "https://cdn.simpleicons.org/ycombinator/F0652F" },
  devto: { label: "dev.to", icon: "https://cdn.simpleicons.org/devdotto/111111" },
  youtube: { label: "YouTube", icon: "https://cdn.simpleicons.org/youtube/FF0000" },
  blog: { label: "Blog", glyph: "rss" },
  other: { label: "Other", glyph: "dot" },
};

const STORE_KEYS = {
  saved: "tool-notes:saved",
  read: "tool-notes:read",
  hidden: "tool-notes:hidden",
};

const state = {
  items: [],
  category: "all",
  type: "all",
  mode: "all",
  sort: "newest",
  query: "",
  sources: new Set(),
  saved: loadSet(STORE_KEYS.saved),
  read: loadSet(STORE_KEYS.read),
  hidden: loadSet(STORE_KEYS.hidden),
};

const els = {
  feed: document.querySelector("#feed"),
  empty: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  categoryFilters: document.querySelector("#categoryFilters"),
  typeFilters: document.querySelector("#typeFilters"),
  sourceFilters: document.querySelector("#sourceFilters"),
  itemCount: document.querySelector("#itemCount"),
  lastUpdated: document.querySelector("#lastUpdated"),
  toast: document.querySelector("#toast"),
  refresh: document.querySelector("#refreshButton"),
  filterToggle: document.querySelector("#filterToggleButton"),
  filterClose: document.querySelector("#filterCloseButton"),
  filterDone: document.querySelector("#filterDoneButton"),
  filterBackdrop: document.querySelector("#filterBackdrop"),
  filterSheet: document.querySelector("#filterSheet"),
  filterBadge: document.querySelector("#filterBadge"),
  activeFilters: document.querySelector("#activeFilters"),
  clearFilters: document.querySelector("#clearFiltersButton"),
  all: document.querySelector("#allItemsButton"),
  saved: document.querySelector("#savedItemsButton"),
  newest: document.querySelector("#newestSortButton"),
  popular: document.querySelector("#popularSortButton"),
};

init();

async function init() {
  bindEvents();
  await loadFeed();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function bindEvents() {
  els.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  els.refresh.addEventListener("click", async () => {
    await loadFeed(true);
  });

  els.all.addEventListener("click", () => setMode("all"));
  els.saved.addEventListener("click", () => setMode("saved"));
  els.newest.addEventListener("click", () => setSort("newest"));
  els.popular.addEventListener("click", () => setSort("popular"));
  els.filterToggle.addEventListener("click", openFilterSheet);
  els.filterClose.addEventListener("click", closeFilterSheet);
  els.filterDone.addEventListener("click", closeFilterSheet);
  els.filterBackdrop.addEventListener("click", closeFilterSheet);
  els.clearFilters.addEventListener("click", clearFilters);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFilterSheet();
  });
}

async function loadFeed(force = false) {
  els.lastUpdated.textContent = "Loading feed...";
  try {
    const url = force ? `${DATA_URL}?t=${Date.now()}` : DATA_URL;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
    const payload = await response.json();
    state.items = Array.isArray(payload.items) ? payload.items : [];
    renderFilters();
    render();
    const updated = payload.generatedAt ? formatDate(payload.generatedAt) : "unknown";
    els.lastUpdated.textContent = `Updated ${updated}`;
    if (force) showToast("Feed reloaded");
  } catch (error) {
    els.feed.innerHTML = "";
    els.empty.classList.remove("hidden");
    els.empty.querySelector("h2").textContent = "Could not load feed";
    els.empty.querySelector("p").textContent = "Run the collector or check data/items.json.";
    els.lastUpdated.textContent = "Feed unavailable";
    console.error(error);
  }
}

function renderFilters() {
  renderCategoryFilters();
  renderChipRow(els.typeFilters, "type", TYPE_LABELS);
  renderSourceFilters();
  renderActiveFilters();
}

function renderCategoryFilters() {
  const values = [...new Set(state.items.map((item) => item.category).filter(Boolean))];
  const available = Object.keys(CATEGORY_LABELS).filter((value) => values.includes(value));
  const chips = [{ value: "all", label: "All" }, ...available.map((value) => ({ value, label: CATEGORY_LABELS[value] }))];
  els.categoryFilters.innerHTML = chips
    .map((chip) => {
      const active = state.category === chip.value ? " active" : "";
      return `<button class="chip tool-chip${active}" type="button" data-category="${escapeAttr(chip.value)}" aria-label="${escapeAttr(chip.label)}" title="${escapeAttr(chip.label)}">${renderCategoryIcon(chip.value)}</button>`;
    })
    .join("");
  els.categoryFilters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      renderFilters();
      render();
    });
  });
}

function renderChipRow(container, key, labels) {
  const values = [...new Set(state.items.map((item) => item[key]).filter(Boolean))];
  const available = Object.keys(labels).filter((value) => values.includes(value));
  const chips = [{ value: "all", label: "All" }, ...available.map((value) => ({ value, label: labels[value] }))];
  container.innerHTML = chips
    .map((chip) => {
      const active = state[key] === chip.value ? " active" : "";
      return `<button class="chip${active}" type="button" data-${key}="${escapeAttr(chip.value)}">${escapeHtml(chip.label)}</button>`;
    })
    .join("");
  container.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state[key] = button.dataset[key];
      renderFilters();
      render();
    });
  });
}

function renderSourceFilters() {
  const values = [...new Set(state.items.map((item) => item.sourceGroup || inferSourceGroup(item)).filter(Boolean))];
  const available = Object.keys(SOURCE_LABELS).filter((value) => values.includes(value));
  const chips = [{ value: "all", label: "All sources" }, ...available.map((value) => ({ value, label: SOURCE_LABELS[value] }))];
  els.sourceFilters.innerHTML = chips
    .map((chip) => {
      const active = chip.value === "all" ? state.sources.size === 0 : state.sources.has(chip.value);
      return `<button class="chip source-chip${active ? " active" : ""}" type="button" data-source="${escapeAttr(chip.value)}" aria-label="${escapeAttr(chip.label)}" title="${escapeAttr(chip.label)}">${renderSourceIcon(chip.value)}</button>`;
    })
    .join("");
  els.sourceFilters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.source;
      if (value === "all") {
        state.sources.clear();
      } else if (state.sources.has(value)) {
        state.sources.delete(value);
      } else {
        state.sources.add(value);
      }
      renderFilters();
      render();
    });
  });
}

function renderSourceIcon(source) {
  const icon = SOURCE_ICONS[source] || SOURCE_ICONS.other;
  const label = SOURCE_LABELS[source] || icon.label || source;
  if (icon.icon) {
    return `<img src="${escapeAttr(icon.icon)}" alt="" loading="lazy"><span class="source-name">${escapeHtml(label)}</span>`;
  }
  if (icon.glyph === "all") {
    return `<span class="source-glyph all-glyph" aria-hidden="true"><span></span><span></span><span></span><span></span></span><span class="source-name">${escapeHtml(label)}</span>`;
  }
  if (icon.glyph === "rss") {
    return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 19h.01"></path><path d="M5 5a14 14 0 0 1 14 14"></path><path d="M5 12a7 7 0 0 1 7 7"></path></svg><span class="source-name">${escapeHtml(label)}</span>`;
  }
  return `<span class="source-glyph dot-glyph" aria-hidden="true"></span><span class="source-name">${escapeHtml(label)}</span>`;
}

function renderCategoryIcon(category) {
  const icon = CATEGORY_ICONS[category] || CATEGORY_ICONS.all;
  const label = CATEGORY_LABELS[category] || icon.label || category;
  if (icon.icon) {
    return `<img src="${escapeAttr(icon.icon)}" alt="" loading="lazy"><span class="source-name">${escapeHtml(label)}</span>`;
  }
  if (icon.glyph === "ai") {
    return `<span class="source-glyph ai-glyph" aria-hidden="true">AI</span><span class="source-name">${escapeHtml(label)}</span>`;
  }
  return `<span class="source-glyph all-glyph" aria-hidden="true"><span></span><span></span><span></span><span></span></span><span class="source-name">${escapeHtml(label)}</span>`;
}

function setMode(mode) {
  state.mode = mode;
  [els.all, els.saved].forEach((button) => button.classList.remove("active"));
  els[mode].classList.add("active");
  render();
}

function setSort(sort) {
  state.sort = sort;
  els.newest.classList.toggle("active", sort === "newest");
  els.popular.classList.toggle("active", sort === "popular");
  render();
}

function openFilterSheet() {
  els.filterBackdrop.classList.remove("hidden");
  els.filterSheet.classList.remove("hidden");
  document.body.classList.add("sheet-open");
}

function closeFilterSheet() {
  els.filterBackdrop.classList.add("hidden");
  els.filterSheet.classList.add("hidden");
  document.body.classList.remove("sheet-open");
}

function clearFilters() {
  state.sources.clear();
  state.category = "all";
  state.type = "all";
  renderFilters();
  render();
}

function render() {
  const items = getVisibleItems();
  els.itemCount.textContent = String(items.length);
  els.feed.innerHTML = items.map(renderCard).join("");
  els.empty.classList.toggle("hidden", items.length > 0);
  renderActiveFilters();
  bindCardActions();
}

function renderActiveFilters() {
  const filters = [];
  state.sources.forEach((source) => filters.push(SOURCE_LABELS[source] || source));
  if (state.category !== "all") filters.push(CATEGORY_LABELS[state.category] || state.category);
  if (state.type !== "all") filters.push(TYPE_LABELS[state.type] || state.type);

  els.filterBadge.textContent = String(filters.length);
  els.filterBadge.classList.toggle("hidden", filters.length === 0);
  els.activeFilters.classList.toggle("hidden", filters.length === 0);
  els.activeFilters.innerHTML = filters.map((filter) => `<span>${escapeHtml(filter)}</span>`).join("");
}

function getVisibleItems() {
  return state.items
    .filter((item) => !state.hidden.has(item.id))
    .filter((item) => state.category === "all" || item.category === state.category)
    .filter((item) => state.type === "all" || item.type === state.type)
    .filter((item) => state.sources.size === 0 || state.sources.has(item.sourceGroup || inferSourceGroup(item)))
    .filter((item) => state.mode !== "saved" || state.saved.has(item.id))
    .filter((item) => state.mode !== "unread" || !state.read.has(item.id))
    .filter((item) => matchesQuery(item))
    .sort((a, b) => {
      if (state.sort === "popular") {
        const popularityDelta = Number(b.popularity || b.score || 0) - Number(a.popularity || a.score || 0);
        if (popularityDelta !== 0) return popularityDelta;
      }
      const dateDelta = Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0);
      if (dateDelta !== 0) return dateDelta;
      const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
}

function matchesQuery(item) {
  if (!state.query) return true;
  const haystack = [
    item.title,
    item.excerpt,
    item.sourceName,
    CATEGORY_LABELS[item.category],
    TYPE_LABELS[item.type],
    SOURCE_LABELS[item.sourceGroup || inferSourceGroup(item)],
    ...(item.tags || []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.query);
}

function renderCard(item) {
  const isSaved = state.saved.has(item.id);
  const isRead = state.read.has(item.id);
  return `
    <article class="note-card${isRead ? " read" : ""}" data-id="${escapeAttr(item.id)}">
      <div class="note-meta">
        <span>${escapeHtml(SOURCE_LABELS[item.sourceGroup || inferSourceGroup(item)] || "Source")}</span>
        <span>${escapeHtml(CATEGORY_LABELS[item.category] || item.category || "Tool")}</span>
        <span>${escapeHtml(item.sourceName || "Unknown")}</span>
        <span>${escapeHtml(formatDate(item.publishedAt))}</span>
      </div>
      <h2><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer" data-action="open">${escapeHtml(item.title)}</a></h2>
      <p class="excerpt">${escapeHtml(item.excerpt || "No summary available.")}</p>
      <div class="note-actions">
        <button class="action-button icon-action${isSaved ? " active" : ""}" type="button" data-action="save" aria-label="${isSaved ? "Remove saved" : "Save"}" title="${isSaved ? "Saved" : "Save"}">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
        <button class="action-button icon-action" type="button" data-action="copy" aria-label="Copy prompt" title="Copy prompt">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M8 7h8"></path>
            <path d="M8 12h8"></path>
            <path d="M8 17h5"></path>
            <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path>
          </svg>
        </button>
      </div>
    </article>
  `;
}

function inferSourceGroup(item) {
  const text = `${item.sourceName || ""} ${item.url || ""}`.toLowerCase();
  if (text.includes("zenn")) return "zenn";
  if (text.includes("qiita")) return "qiita";
  if (text.includes("note")) return "note";
  if (text.includes("reddit")) return "reddit";
  if (text.includes("hn ") || text.includes("hacker news") || text.includes("hnrss")) return "hn";
  if (text.includes("dev.to")) return "devto";
  if (text.includes("youtube") || text.includes("youtu.be")) return "youtube";
  if (text.includes("blog")) return "blog";
  return "other";
}

function bindCardActions() {
  els.feed.querySelectorAll("[data-action]").forEach((control) => {
    control.addEventListener("click", async (event) => {
      const card = event.target.closest(".note-card");
      const item = state.items.find((entry) => entry.id === card?.dataset.id);
      if (!item) return;
      const action = event.target.dataset.action;

      if (action === "open") {
        state.read.add(item.id);
        saveSet(STORE_KEYS.read, state.read);
        return;
      }
      if (action === "save") toggleSet(state.saved, STORE_KEYS.saved, item.id);
      if (action === "copy") {
        await copyPrompt(item);
        showToast("Prompt copied");
      }
      render();
    });
  });
}

async function copyPrompt(item) {
  const prompt = [
    "以下の記事/動画について、日本語で整理してください。",
    "",
    "目的:",
    "- 要点",
    "- 試す価値",
    "- 実践手順",
    "- 私の仕事や学習への応用案",
    "- 追加で調べるべきこと",
    "",
    `タイトル: ${item.title}`,
    `URL: ${item.url}`,
    `概要: ${item.excerpt || ""}`,
  ].join("\n");

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(prompt);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = prompt;
  textarea.setAttribute("readonly", "");
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function toggleSet(set, key, id) {
  if (set.has(id)) set.delete(id);
  else set.add(id);
  saveSet(key, set);
}

function loadSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function saveSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function formatDate(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(date);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("visible"), 1800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
