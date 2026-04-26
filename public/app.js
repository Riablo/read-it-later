const state = {
  status: "inbox",
  items: [],
  counts: { inbox: 0, trash: 0 },
  busy: false,
  loading: false,
  lastActivationRefreshAt: 0
};

const elements = {
  body: document.body,
  form: document.querySelector("#save-form"),
  input: document.querySelector("#url-input"),
  list: document.querySelector("#item-list"),
  empty: document.querySelector("#empty-state"),
  template: document.querySelector("#item-template"),
  statusLine: document.querySelector("#status-line"),
  inboxCount: document.querySelector("#inbox-count"),
  trashCount: document.querySelector("#trash-count"),
  trashActions: document.querySelector("#trash-actions"),
  clearTrashButton: document.querySelector("#clear-trash-button"),
  tabs: [...document.querySelectorAll("[data-status]")]
};

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
    return;
  }

  state.loading = true;
  setActiveTab();
  setStatus(options.silent ? "正在刷新..." : "正在加载...");

  try {
    const data = await requestJson(`/api/items?status=${state.status}`);
    state.items = data.items;
    applyCounts(data.counts);
    renderItems();
    setStatus(options.silent ? "已更新" : state.status === "trash" ? "回收站" : "收件箱");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.loading = false;
  }
}

function renderItems() {
  elements.list.replaceChildren();
  elements.empty.hidden = state.items.length > 0;

  for (const item of state.items) {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const openButton = node.querySelector(".open-area");
    const trashButton = node.querySelector(".trash-button");
    const restoreButton = node.querySelector(".restore-button");

    node.dataset.id = item.id;
    node.querySelector(".domain-chip").textContent = item.domain;
    node.querySelector(".title").textContent = item.title;
    node.querySelector(".summary").textContent = item.summary;
    node.querySelector(".meta").textContent = `${item.host} · ${formatDate(state.status === "trash" ? item.deletedAt || item.updatedAt : item.createdAt)}`;

    openButton.addEventListener("click", () => openItem(item));
    trashButton.addEventListener("click", () => trashItem(item));
    restoreButton.addEventListener("click", () => restoreItem(item));
    elements.list.append(node);
  }
}

async function openItem(item) {
  window.open(item.url, "_blank", "noopener,noreferrer");

  if (state.status !== "inbox") {
    return;
  }

  await trashItem(item);
}

async function trashItem(item) {
  if (state.status !== "inbox") {
    return;
  }

  state.items = state.items.filter((candidate) => candidate.id !== item.id);
  applyCounts({
    inbox: Math.max((state.counts.inbox || 1) - 1, 0),
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
  elements.form.addEventListener("submit", saveFromForm);
  elements.clearTrashButton.addEventListener("click", clearTrash);
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
