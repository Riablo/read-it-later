const SORT_STORAGE_KEY = "readlater.sort";

const state = {
  status: "inbox",
  query: "",
  sort: readStoredSort(),
  items: [],
  counts: { inbox: 0, kept: 0, trash: 0 },
  busy: false,
  loading: false,
  pendingLoad: false,
  lastActivationRefreshAt: 0
};

const elements = {
  body: document.body,
  form: document.querySelector("#save-form"),
  input: document.querySelector("#url-input"),
  list: document.querySelector("#item-list"),
  empty: document.querySelector("#empty-state"),
  template: document.querySelector("#item-template"),
  searchInput: document.querySelector("#search-input"),
  sortSelect: document.querySelector("#sort-select"),
  statusLine: document.querySelector("#status-line"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyText: document.querySelector("#empty-text"),
  inboxCount: document.querySelector("#inbox-count"),
  keptCount: document.querySelector("#kept-count"),
  trashCount: document.querySelector("#trash-count"),
  trashActions: document.querySelector("#trash-actions"),
  clearTrashButton: document.querySelector("#clear-trash-button"),
  tabs: [...document.querySelectorAll("[data-status]")]
};

function readStoredSort() {
  try {
    return localStorage.getItem(SORT_STORAGE_KEY) === "asc" ? "asc" : "desc";
  } catch {
    return "desc";
  }
}

function storeSort(sort) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch {
    // Ignore storage failures so sorting still works in restricted browsing modes.
  }
}

function setStatus(message, tone = "muted") {
  elements.statusLine.textContent = message;
  elements.statusLine.dataset.tone = tone;
}

async function requestJson(path, options) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...options?.headers
    },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败。");
  }

  return data;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function applyCounts(counts) {
  state.counts = counts || state.counts;
  elements.inboxCount.textContent = String(state.counts.inbox ?? 0);
  elements.keptCount.textContent = String(state.counts.kept ?? 0);
  elements.trashCount.textContent = String(state.counts.trash ?? 0);
  updateClearTrashButton();
}

function setActiveTab() {
  elements.body.dataset.status = state.status;
  for (const tab of elements.tabs) {
    const active = tab.dataset.status === state.status;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
  updateClearTrashButton();
}

function updateClearTrashButton() {
  const showButton = state.status === "trash";
  elements.trashActions.hidden = !showButton;
  elements.clearTrashButton.disabled = (state.counts.trash ?? 0) === 0 || state.busy;
}

async function loadItems(options = {}) {
  if (state.loading) {
    state.pendingLoad = true;
    return;
  }

  state.loading = true;
  setActiveTab();
  setStatus(options.silent ? "正在刷新..." : "正在加载...");

  try {
    const params = new URLSearchParams({
      status: state.status,
      sort: state.sort
    });

    if (state.query.trim()) {
      params.set("q", state.query.trim());
    }

    const data = await requestJson(`/api/items?${params}`);
    state.items = data.items;
    applyCounts(data.counts);
    renderItems();
    setStatus(options.silent ? "已更新" : listStatusMessage());
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.loading = false;
    if (state.pendingLoad) {
      state.pendingLoad = false;
      await loadItems(options);
    }
  }
}

function renderItems() {
  elements.list.replaceChildren();
  elements.empty.hidden = state.items.length > 0;
  renderEmptyState();

  for (const item of state.items) {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const openButton = node.querySelector(".open-area");
    const trashButton = node.querySelector(".trash-button");
    const keepButton = node.querySelector(".keep-button");
    const restoreButton = node.querySelector(".restore-button");

    node.dataset.id = item.id;
    node.querySelector(".domain-chip").textContent = item.domain;
    node.querySelector(".title").textContent = item.title;
    node.querySelector(".summary").textContent = item.summary;
    node.querySelector(".meta").textContent = `${item.host} · ${formatDate(displayDate(item))}`;
    node.querySelector(".trash-label").textContent = state.status === "kept" ? "删除" : "回收";

    openButton.addEventListener("click", () => openItem(item));
    trashButton.addEventListener("click", () => trashItem(item));
    keepButton.addEventListener("click", () => keepItem(item));
    restoreButton.addEventListener("click", () => restoreItem(item));
    elements.list.append(node);
  }
}

function renderEmptyState() {
  const hasQuery = state.query.trim().length > 0;
  elements.emptyTitle.textContent = hasQuery ? "没有匹配的链接" : "这里还没有链接";
  elements.emptyText.textContent = hasQuery ? "换个关键词试试。" : "当前列表为空。";
}

function statusLabel(status) {
  if (status === "kept") {
    return "留存";
  }

  return status === "trash" ? "回收站" : "收件箱";
}

function listStatusMessage() {
  const label = statusLabel(state.status);
  if (!state.query.trim()) {
    return label;
  }

  return `${label} · ${state.items.length} 个匹配`;
}

function displayDate(item) {
  if (state.status === "trash") {
    return item.deletedAt || item.updatedAt;
  }

  return state.status === "kept" ? item.updatedAt : item.createdAt;
}

async function openItem(item) {
  window.open(item.url, "_blank", "noopener,noreferrer");

  if (state.status !== "inbox") {
    return;
  }

  await trashItem(item);
}

async function trashItem(item) {
  if (state.status === "trash") {
    return;
  }

  state.items = state.items.filter((candidate) => candidate.id !== item.id);
  const fromStatus = state.status;
  applyCounts({
    ...state.counts,
    [fromStatus]: Math.max((state.counts[fromStatus] || 1) - 1, 0),
    trash: (state.counts.trash || 0) + 1
  });
  renderItems();
  setStatus("已移入回收站");

  try {
    const data = await requestJson(`/api/items/${encodeURIComponent(item.id)}/trash`, {
      method: "POST"
    });
    applyCounts(data.counts);
  } catch (error) {
    setStatus(error.message, "error");
    await loadItems();
  }
}

async function keepItem(item) {
  if (state.status === "kept") {
    return;
  }

  state.items = state.items.filter((candidate) => candidate.id !== item.id);
  const fromStatus = state.status;
  applyCounts({
    ...state.counts,
    [fromStatus]: Math.max((state.counts[fromStatus] || 1) - 1, 0),
    kept: (state.counts.kept || 0) + 1
  });
  renderItems();
  setStatus("已移到留存");

  try {
    const data = await requestJson(`/api/items/${encodeURIComponent(item.id)}/keep`, {
      method: "POST"
    });
    applyCounts(data.counts);
  } catch (error) {
    setStatus(error.message, "error");
    await loadItems();
  }
}

function refreshOnActivation() {
  if (document.visibilityState !== "visible" || state.busy || state.loading) {
    return;
  }

  const now = Date.now();
  if (now - state.lastActivationRefreshAt < 1000) {
    return;
  }

  state.lastActivationRefreshAt = now;
  loadItems({ silent: true });
}

async function restoreItem(item) {
  setStatus("正在恢复...");

  try {
    const data = await requestJson(`/api/items/${encodeURIComponent(item.id)}/restore`, {
      method: "POST"
    });
    applyCounts(data.counts);
    state.items = state.items.filter((candidate) => candidate.id !== item.id);
    renderItems();
    setStatus("已恢复");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function clearTrash() {
  const count = state.counts.trash ?? 0;

  if (count === 0 || state.busy) {
    return;
  }

  const confirmed = window.confirm(`确认永久清空回收站中的 ${count} 个链接吗？此操作无法撤销。`);
  if (!confirmed) {
    setStatus("已取消清空");
    return;
  }

  state.busy = true;
  updateClearTrashButton();
  setStatus("正在清空回收站...");

  try {
    const data = await requestJson("/api/trash/clear", {
      method: "POST",
      body: JSON.stringify({ confirm: "CLEAR_TRASH" })
    });

    state.items = [];
    applyCounts(data.counts);
    renderItems();
    setStatus(`已清空 ${data.removed} 个链接`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    updateClearTrashButton();
  }
}

async function saveFromForm(event) {
  event.preventDefault();

  if (state.busy) {
    return;
  }

  const url = new FormData(elements.form).get("url");
  state.busy = true;
  elements.form.classList.add("is-busy");
  setStatus("正在保存...");

  try {
    const data = await requestJson("/api/save", {
      method: "POST",
      body: JSON.stringify({ url })
    });

    applyCounts(data.counts);
    elements.form.reset();
    state.status = "inbox";
    await loadItems();
    setStatus("已保存");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    elements.form.classList.remove("is-busy");
  }
}

function bindEvents() {
  let searchTimer = 0;

  elements.sortSelect.value = state.sort;
  elements.form.addEventListener("submit", saveFromForm);
  elements.clearTrashButton.addEventListener("click", clearTrash);
  elements.searchInput.addEventListener("input", () => {
    state.query = elements.searchInput.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadItems(), 180);
  });
  elements.sortSelect.addEventListener("change", () => {
    state.sort = elements.sortSelect.value === "asc" ? "asc" : "desc";
    storeSort(state.sort);
    loadItems();
  });
  document.addEventListener("visibilitychange", refreshOnActivation);
  window.addEventListener("focus", refreshOnActivation);

  for (const tab of elements.tabs) {
    tab.addEventListener("click", () => {
      state.status = tab.dataset.status;
      loadItems();
    });
  }
}

bindEvents();
loadItems();
