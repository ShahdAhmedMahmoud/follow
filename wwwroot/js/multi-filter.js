/**
 * Searchable multi-select filter.
 * Progressive enhancement: hides the original <select> (kept in the DOM, in sync)
 * and renders a combobox (desktop dropdown / mobile bottom sheet) in its place.
 */

const MOBILE_MQ = "(max-width: 767.98px)";

const ICONS = {
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// 1:1 character replacements only, so indexes stay valid for highlighting
const normalize = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function highlight(text, q) {
  const t = String(text ?? "");
  if (!q) return esc(t);
  const i = normalize(t).indexOf(q);
  if (i < 0) return esc(t);
  return (
    esc(t.slice(0, i)) +
    "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" +
    esc(t.slice(i + q.length))
  );
}

let currentClose = null; // only one panel open at a time

export function createMultiFilter(select, options = {}) {
  const labelEl = select.id
    ? document.querySelector(`label[for="${select.id}"]`)
    : null;
  const cfg = {
    placeholder: "الكل",
    title: (labelEl && labelEl.textContent.trim()) || "",
    icon: "",
    searchPlaceholder: "ابحث...",
    noItemsText: "لا توجد بيانات",
    emptyText: "لا توجد نتائج مطابقة",
    onChange() {},
    ...options,
  };

  const uid = `mf-${select.id || Math.random().toString(36).slice(2, 8)}`;
  const mq = window.matchMedia(MOBILE_MQ);

  /* ---------- DOM ---------- */
  const root = document.createElement("div");
  root.className = "mf";
  root.dataset.open = "false";
  root.dataset.hasValue = "false";
  root.innerHTML = `
    <div class="mf-trigger" role="combobox" tabindex="0" aria-haspopup="listbox"
         aria-expanded="false" aria-controls="${uid}-list">
      ${cfg.icon ? `<span class="mf-icon">${cfg.icon}</span>` : ""}
      <span class="mf-values"></span>
      <span class="mf-badge" hidden></span>
      <span class="mf-clear" role="button" tabindex="-1" aria-label="مسح التحديد" hidden>${ICONS.close}</span>
      <span class="mf-chevron">${ICONS.chevron}</span>
    </div>
    <div class="mf-backdrop"></div>
    <div class="mf-panel" role="dialog" aria-label="${esc(cfg.title)}">
      <div class="mf-handle"></div>
      <div class="mf-head">
        <span class="mf-title">${esc(cfg.title)}</span>
        <button type="button" class="mf-x" aria-label="إغلاق">${ICONS.close}</button>
      </div>
      <div class="mf-search">
        ${ICONS.search}
        <input type="text" class="mf-input" autocomplete="off" spellcheck="false"
               placeholder="${esc(cfg.searchPlaceholder)}" aria-controls="${uid}-list" />
        <button type="button" class="mf-search-clear" aria-label="مسح البحث" hidden>${ICONS.close}</button>
      </div>
      <div class="mf-tools">
        <button type="button" class="mf-all">تحديد الكل</button>
        <button type="button" class="mf-none">مسح الكل</button>
        <span class="mf-summary"></span>
      </div>
      <ul class="mf-list" id="${uid}-list" role="listbox" aria-multiselectable="true"></ul>
      <div class="mf-foot"><button type="button" class="mf-done">تم</button></div>
    </div>`;

  select.insertAdjacentElement("afterend", root);
  select.style.display = "none";
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  const $ = (sel) => root.querySelector(sel);
  const trigger = $(".mf-trigger");
  const valuesEl = $(".mf-values");
  const badgeEl = $(".mf-badge");
  const clearEl = $(".mf-clear");
  const panel = $(".mf-panel");
  const input = $(".mf-input");
  const searchClear = $(".mf-search-clear");
  const allBtn = $(".mf-all");
  const noneBtn = $(".mf-none");
  const summary = $(".mf-summary");
  const listEl = $(".mf-list");

  /* ---------- state ---------- */
  let items = [];
  let selected = new Set();
  let visible = [];
  let query = "";
  let active = -1;
  let isOpen = false;

  /* ---------- rendering ---------- */
  function syncSelect() {
    select.multiple = true;
    select.innerHTML = items
      .map(
        (i) =>
          `<option value="${esc(i.id)}"${selected.has(i.id) ? " selected" : ""}>${esc(i.label)}</option>`,
      )
      .join("");
  }

  function renderTrigger() {
    const sel = items.filter((i) => selected.has(i.id));
    root.dataset.hasValue = sel.length ? "true" : "false";
    if (!sel.length) {
      valuesEl.innerHTML = `<span class="mf-placeholder">${esc(cfg.placeholder)}</span>`;
    } else {
      valuesEl.innerHTML = `<span class="mf-chip">${esc(sel[0].label)}</span>`;
    }
    if (sel.length > 1) {
      badgeEl.hidden = false;
      badgeEl.textContent = `+${sel.length - 1}`;
    } else {
      badgeEl.hidden = true;
    }
    clearEl.hidden = sel.length === 0;
    trigger.title = sel.map((i) => i.label).join("، ");
  }

  function updateTools() {
    allBtn.textContent = query ? "تحديد النتائج" : "تحديد الكل";
    allBtn.disabled = visible.length === 0;
    noneBtn.disabled = selected.size === 0;
    summary.textContent = `${selected.size} محدد من ${items.length}`;
  }

  function renderList() {
    const prevScroll = listEl.scrollTop;
    const q = normalize(query.trim());
    visible = q
      ? items.filter(
          (it) =>
            normalize(it.label).includes(q) || normalize(it.hint).includes(q),
        )
      : items.slice();
    if (active >= visible.length) active = visible.length - 1;

    if (!items.length) {
      listEl.innerHTML = `<li class="mf-empty">${esc(cfg.noItemsText)}</li>`;
    } else if (!visible.length) {
      listEl.innerHTML = `<li class="mf-empty">${esc(cfg.emptyText)}</li>`;
    } else {
      listEl.innerHTML = visible
        .map((it, i) => {
          const isSel = selected.has(it.id);
          return `<li class="mf-opt${isSel ? " is-selected" : ""}${i === active ? " is-active" : ""}"
                      role="option" id="${uid}-o${i}" aria-selected="${isSel}" data-id="${esc(it.id)}">
                    <span class="mf-check">${ICONS.check}</span>
                    <span class="mf-opt-body">
                      <span class="mf-opt-label">${highlight(it.label, q)}</span>
                      ${it.hint ? `<span class="mf-opt-hint">${highlight(it.hint, q)}</span>` : ""}
                    </span>
                  </li>`;
        })
        .join("");
    }
    listEl.scrollTop = prevScroll;
    searchClear.hidden = !query;
    updateTools();
  }

  function afterChange() {
    syncSelect();
    renderTrigger();
    updateTools();
  }

  function emit() {
    cfg.onChange(Array.from(selected));
  }

  /* ---------- selection ---------- */
  function toggle(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    const li = listEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (li) {
      const on = selected.has(id);
      li.classList.toggle("is-selected", on);
      li.setAttribute("aria-selected", String(on));
    }
    afterChange();
    emit();
  }

  function selectVisible() {
    visible.forEach((it) => selected.add(it.id));
    renderList();
    afterChange();
    emit();
  }

  function clearAll() {
    if (!selected.size) return;
    selected.clear();
    if (isOpen) renderList();
    afterChange();
    emit();
  }

  function setActive(i) {
    active = i;
    listEl.querySelectorAll(".mf-opt").forEach((el, idx) => {
      el.classList.toggle("is-active", idx === i);
      if (idx === i) {
        el.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", el.id);
      }
    });
  }

  /* ---------- open / close ---------- */
  function position() {
    root.removeAttribute("data-align");
    if (mq.matches) return;
    const r = panel.getBoundingClientRect();
    if (r.left < 8) root.dataset.align = "left";
    else if (r.right > window.innerWidth - 8) root.dataset.align = "right";
  }

  function onOutside(e) {
    if (isOpen && !root.contains(e.target)) closePanel();
  }

  function openPanel() {
    if (isOpen) return;
    if (currentClose) currentClose();
    isOpen = true;
    currentClose = closePanel;
    query = "";
    input.value = "";
    active = -1;
    root.dataset.open = "true";
    trigger.setAttribute("aria-expanded", "true");
    renderList();
    position();
    if (mq.matches) document.body.classList.add("mf-sheet-open");
    else input.focus({ preventScroll: true });
    document.addEventListener("pointerdown", onOutside, true);
  }

  function closePanel(returnFocus = false) {
    if (!isOpen) return;
    isOpen = false;
    if (currentClose === closePanel) currentClose = null;
    root.dataset.open = "false";
    trigger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("mf-sheet-open");
    document.removeEventListener("pointerdown", onOutside, true);
    if (returnFocus === true) trigger.focus();
  }

  /* ---------- events ---------- */
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest(".mf-clear")) {
      e.stopPropagation();
      clearAll();
      return;
    }
    if (t.closest(".mf-trigger")) {
      isOpen ? closePanel() : openPanel();
      return;
    }
    const opt = t.closest(".mf-opt");
    if (opt) {
      toggle(opt.dataset.id);
      if (!mq.matches) input.focus({ preventScroll: true });
      return;
    }
    if (t.closest(".mf-all")) return selectVisible();
    if (t.closest(".mf-none")) return clearAll();
    if (t.closest(".mf-search-clear")) {
      query = "";
      input.value = "";
      renderList();
      input.focus({ preventScroll: true });
      return;
    }
    if (t.closest(".mf-x") || t.closest(".mf-done") || t.closest(".mf-backdrop")) {
      closePanel(true);
    }
  });

  input.addEventListener("input", () => {
    query = input.value;
    active = -1;
    renderList();
  });

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      closePanel(true);
      return;
    }
    if (e.target === trigger) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.target === input) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (visible.length) setActive(Math.min(visible.length - 1, active + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (visible.length) setActive(Math.max(0, active - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0 && visible[active]) toggle(visible[active].id);
        else if (query && visible.length) selectVisible();
      }
    }
  });

  // clicking the field's <label> opens the panel (the original select is hidden)
  if (labelEl) {
    labelEl.addEventListener("click", (e) => {
      e.preventDefault();
      openPanel();
    });
  }

  mq.addEventListener("change", () => {
    if (isOpen) {
      document.body.classList.toggle("mf-sheet-open", mq.matches);
      position();
    }
  });

  /* ---------- public API ---------- */
  function setOptions(newItems, selectedIds) {
    items = (newItems || []).map((i) => ({
      id: String(i.id),
      label: String(i.label ?? i.id),
      hint: i.hint ? String(i.hint) : "",
    }));
    const valid = new Set(items.map((i) => i.id));
    selected = new Set((selectedIds || []).map(String).filter((id) => valid.has(id)));
    afterChange();
    if (isOpen) renderList();
  }

  function setSelected(ids) {
    const valid = new Set(items.map((i) => i.id));
    selected = new Set((ids || []).map(String).filter((id) => valid.has(id)));
    afterChange();
    if (isOpen) renderList();
  }

  renderTrigger();

  return {
    element: root,
    setOptions,
    setSelected,
    getSelected: () => Array.from(selected),
    open: openPanel,
    close: () => closePanel(),
  };
}