/**
 * ERP SYSTEM ENGINE - MAINTENANCE & UNIFIED RESTRUCTURED REPORTS ENGINE
 */

import { erpApi } from "./api.js";
import { renderDashboardCharts } from "./dashboard-charts.js?v=7";
import { createMultiFilter } from "./multi-filter.js?v=1";
// flatpickr loaded globally via CDN
const flatpickr = window.flatpickr;

const ICON_BTN_EDIT =
  '<svg class="icon-action" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const ICON_BTN_DELETE =
  '<svg class="icon-action" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
const ICON_BTN_PRINT =
  '<svg class="icon-action" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>';

/* ── Global flatpickr configuration ──────────────────────────────
 * All date inputs use DD/MM/YYYY display format.
 * The underlying value stored in the DOM remains YYYY-MM-DD
 * so the API and date arithmetic stay timezone-safe.
 * ─────────────────────────────────────────────────────────────── */
const FLATPICKR_DATE_FORMAT = "d/m/Y"; // flatpickr's d=day, m=month, Y=4-digit year

/* ── Generic escalations / follow-up ("التعليات") status model ──────
 * Canonical response-status values used across the whole app for ANY
 * deduction type (social insurance included). Only 3 states exist:
 *   PENDING  -> لم يتم الرد     (still open, nothing received)
 *   PARTIAL  -> الرد جزئيًا     (still open, partially received)
 *   DONE     -> تم الرد         (closed, fully received)
 * Older builds of this app used slightly different wording
 * ("تم الرد بالكامل" / "تم الرد جزئياً"). normalizeEscalationStatus()
 * maps any legacy value already saved in the database onto the
 * canonical one so existing records keep displaying correctly.
 * ─────────────────────────────────────────────────────────────── */
const ESC_STATUS_PENDING = "غير قابلة للرد";
const ESC_STATUS_PARTIAL = "الرد جزئيًا";
const ESC_STATUS_DONE = "تم الرد";
const ESC_FILTER_ALL = "all";
const ESC_FILTER_NOT_REPLIED = "not-replied";
const ESC_FILTER_REPLYABLE = "replyable";
const ESC_FILTER_REPLIED = "replied";
const ESC_FILTER_UNPAID = "unpaid";

function normalizeEscalationStatus(status) {
  const s = String(status || "").trim();
  if (s === ESC_STATUS_DONE || s === "تم الرد بالكامل") return ESC_STATUS_DONE;
  if (s === ESC_STATUS_PARTIAL || s === "تم الرد جزئياً" || s === "رد جزئي")
    return ESC_STATUS_PARTIAL;
  return ESC_STATUS_PENDING;
}

/**
 * Dynamic day counter shared by every escalation/claim row, regardless
 * of deduction type. The counter never accepts manual input:
 *  - PENDING or PARTIAL  -> today - deductionDate (keeps increasing daily)
 *  - DONE                -> responseDate - deductionDate (frozen)
 * A stray responseDate on a still-open (PENDING/PARTIAL) row is ignored
 * on purpose, since the item hasn't been closed yet.
 */
function computeEscalationDays(deductionDateStr, status, responseDateStr) {
  if (!deductionDateStr) return 0;
  const start = new Date(deductionDateStr);
  const normalized = normalizeEscalationStatus(status);
  const end =
    normalized === ESC_STATUS_DONE && responseDateStr
      ? new Date(responseDateStr)
      : new Date(getTodayLocal());
  const diff = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}

/**
 * Initialise flatpickr on every input[type=date] that exists
 * or will be added later (modals, dynamically rendered rows).
 */
/**
 * Set a date input's value through flatpickr if initialised,
 * otherwise fall back to direct .value assignment.
 * dateStr must be YYYY-MM-DD or empty/null.
 */
function setInputDate(id, dateStr) {
  const input = document.getElementById(id);
  if (!input) return;
  // Filter out invalid/null/default dates (1970-01-01, 0001-01-01, etc.)
  const cleanDate =
    !dateStr ||
    dateStr === "1970-01-01" ||
    dateStr === "0001-01-01" ||
    dateStr === "1970-01-01T00:00:00"
      ? ""
      : dateStr;
  const fp = input._flatpickr;
  if (fp) {
    fp.setDate(cleanDate, true);
  } else {
    input.value = cleanDate;
  }
}

function initFlatpickr() {
  if (typeof flatpickr !== "function") {
    console.warn("flatpickr not loaded — date inputs will use native picker");
    return;
  }
  document
    .querySelectorAll('input[type="date"]:not([data-fp-init])')
    .forEach((input) => {
      input.setAttribute("data-fp-init", "1");
      flatpickr(input, {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d/m/Y",
        allowInput: true,
        clickOpens: true,
        disableMobile: true,
      });
    });
}

let apiOnline = false;
let apiSyncTimer = null;
let apiSyncInFlight = false;
let apiSyncQueued = false;
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Safe short id generator (works without crypto.randomUUID / non-secure contexts). */
function generateId(len = 12) {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID().replace(/-/g, "").slice(0, len);
    }
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      const bytes = new Uint8Array(Math.ceil(len / 2));
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, len);
    }
  } catch (_) {
    /* fall through */
  }
  return ("id" + Date.now().toString(36) + Math.random().toString(36).slice(2))
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, len);
}

function toDateOnly(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO with time: 2026-08-29T... → 2026-08-29
  const tSplit = s.split(/[T ]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(tSplit)) return tSplit;
  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch)
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  // MM/DD/YYYY
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch)
    return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, "0")}-${mdyMatch[2].padStart(2, "0")}`;
  // Excel serial number (numeric)
  const num = parseFloat(s);
  if (!isNaN(num) && num > 30000 && num < 60000) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(d.getTime())) {
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dy = String(d.getDate()).padStart(2, "0");
      return `${yr}-${mo}-${dy}`;
    }
  }
  return null;
}

function normalizeInvoiceForApi(invoice) {
  const source = invoice || {};
  const items = Array.isArray(source.items) ? source.items : [];
  const deductions = Array.isArray(source.deductions) ? source.deductions : [];
  return {
    id: source.id ?? null,
    contractId: source.contractId ?? null,
    number: source.number ?? null,
    date: toDateOnly(source.date),
    dueDate: toDateOnly(source.dueDate),
    status: source.status ?? null,
    paymentStatus: source.paymentStatus ?? null,
    paidAmount: Number(source.paidAmount ?? 0) || 0,
    paymentDate: toDateOnly(source.paymentDate),
    workVolume: Number(source.workVolume ?? 0) || 0,
    variationOrders: Number(source.variationOrders ?? 0) || 0,
    materials: Number(source.materials ?? 0) || 0,
    claims: Number(source.claims ?? 0) || 0,
    vat: Number(source.vat ?? 0) || 0,
    items: items.map((item) => ({
      id: item?.id ?? null,
      description: item?.description ?? "",
      qty: Number(item?.qty ?? 0) || 0,
      rate: Number(item?.rate ?? 0) || 0,
      total: Number(item?.total ?? 0) || 0,
      currentTotal: Number(item?.currentTotal ?? item?.total ?? 0) || 0,
    })),
    deductions: deductions.map((item) => ({
      id: item?.id ?? null,
      description: item?.description ?? null,
      calcType: item?.calcType ?? null,
      val: Number(item?.val ?? 0) || 0,
      amount: Number(item?.amount ?? 0) || 0,
      isRefundable: Boolean(item?.isRefundable),
      calcFromKeys: Array.isArray(item?.calcFromKeys) ? item.calcFromKeys : [],
    })),
  };
}
function renderDeductionLibrary() {
  const container = document.getElementById("deductionLibraryList");
  if (!container) return;
  const library = ensureDeductionLibraryInitialized();
  const searchTerm = (
    document.getElementById("deductionLibrarySearch")?.value || ""
  )
    .trim()
    .toLowerCase();
  const filtered = searchTerm
    ? library.filter((item) =>
        (item.name || "").toLowerCase().includes(searchTerm),
      )
    : library;

  if (!filtered.length) {
    container.innerHTML =
      '<div class="library-empty-state">لا توجد استقطاعات' +
      (searchTerm ? " مطابقة للبحث" : "") +
      "</div>";
    return;
  }
  container.innerHTML = filtered
    .map(
      (item) => `
        <div class="library-item">
            <span class="library-item-name">${escapeHtml(item.name || "")}</span>
            <div style="display:flex;gap:6px;align-items:center;">
                <button type="button" class="btn btn-primary btn-sm" data-library-add="${escapeHtml(item.id)}" data-library-name="${escapeHtml(item.name || "")}" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;">+ إضافة للمستخلص</button>
                <button type="button" class="btn-icon btn-icon-delete" title="حذف" data-library-delete="${escapeHtml(item.id)}">${ICON_BTN_DELETE}</button>
            </div>
        </div>
    `,
    )
    .join("");
  container.querySelectorAll("[data-library-delete]").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDeductionLibraryItem(button.getAttribute("data-library-delete"));
    });
  });
  container.querySelectorAll("[data-library-add]").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const libId = button.getAttribute("data-library-add");
      const libName = button.getAttribute("data-library-name");
      addDeductionFromLibrary(libId, libName);
    });
  });
}

function openDeductionLibrary() {
  renderDeductionLibrary();
  const modal = document.getElementById("modalDeductionLibrary");
  if (modal) modal.classList.add("active");
}

function closeDeductionLibrary() {
  const modal = document.getElementById("modalDeductionLibrary");
  if (modal) modal.classList.remove("active");
}

function addDeductionLibraryItem() {
  const input = document.getElementById("deductionLibraryName");
  const name = input?.value?.trim() || "";
  if (!name) return;
  const library = ensureDeductionLibraryInitialized();
  if (
    library.some(
      (item) => (item.name || "").trim().toLowerCase() === name.toLowerCase(),
    )
  )
    return;
  const id = generateId(12);
  state.deductionLibrary = [...library, { id, name }];
  saveDeductionLibrary(state.deductionLibrary);
  if (input) input.value = "";
  renderDeductionLibrary();
}

function deleteDeductionLibraryItem(id) {
  if (!id) return;
  state.deductionLibrary = ensureDeductionLibraryInitialized().filter(
    (item) => item.id !== id,
  );
  saveDeductionLibrary(state.deductionLibrary);
  renderDeductionLibrary();
}

function addDeductionFromLibrary(libId, libName) {
  // Close the library modal only (not the invoice modal)
  closeDeductionLibrary();
  // Add a new deduction card pre-filled with the selected library item
  addInvDeductionRow({
    description: libName || "",
    libraryId: libId || "",
    calcType: "percent",
    val: 0,
    amount: 0,
    isRefundable: true, // new deductions default to being tracked in التعليات
    calcFromKeys: [],
  });
}

function getInvoiceComponentDefs() {
  const comps = [];

  // 1) Static claim components from the cumulative table
  document.querySelectorAll("#tblCumulativeItems tbody tr").forEach((r) => {
    const key = r.getAttribute("data-item-key");
    if (key) {
      const label = r.querySelector("td strong")?.textContent.trim() || key;
      comps.push({ key, name: label });
    }
  });

  // 2) Dynamic detailed items from #tblInvItems
  document.querySelectorAll("#tblInvItems tbody tr").forEach((tr) => {
    const desc = tr.querySelector(".item-desc")?.value?.trim();
    const qty = parseFloat(tr.querySelector(".item-qty")?.value) || 0;
    const rate = parseFloat(tr.querySelector(".item-rate")?.value) || 0;
    const total = qty * rate;
    if (desc || total > 0) {
      comps.push({
        key: `item_${desc || "unnamed"}_${total}`,
        name: desc || `بند (${total})`,
        isDetailedItem: true,
        itemTotal: total,
      });
    }
  });

  return comps;
}

function resolveDeductionSelectedKeys(d) {
  const allDefs = getInvoiceComponentDefs();
  const allKeys = allDefs.map((c) => c.key);

  if (Array.isArray(d.calcFromKeys)) {
    return d.calcFromKeys;
  }
  if (typeof d.calcFromKeys === "string" && d.calcFromKeys.trim() !== "") {
    return d.calcFromKeys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }

  const legacyKey = (d.calcFrom || "").toString().toLowerCase().trim();
  if (
    !legacyKey ||
    legacyKey === "total_invoice" ||
    legacyKey === "gross" ||
    legacyKey === "wv"
  ) {
    return allKeys;
  }
  if (
    legacyKey === "work_without_materials" ||
    legacyKey === "wv_no_mat" ||
    legacyKey === "total_excl_materials"
  ) {
    return allKeys.filter((k) => k !== "materials");
  }
  if (legacyKey === "total_excl_materials_vat" || legacyKey === "wv_no_vat") {
    return allKeys.filter((k) => k !== "materials" && k !== "vat");
  }
  if (legacyKey === "work_certificate") {
    return ["workVolume", "variationOrders", "materials"].filter((k) =>
      allKeys.includes(k),
    );
  }

  return allKeys;
}

function getCalculationBase(selectedKeys, comps) {
  if (
    !selectedKeys ||
    !Array.isArray(selectedKeys) ||
    selectedKeys.length === 0
  ) {
    return 0;
  }
  const currentComps = comps.currentComponents || {};
  return selectedKeys.reduce((sum, key) => {
    // Standard component keys (workVolume, vat, etc.)
    if (currentComps[key] !== undefined) {
      return sum + (parseFloat(currentComps[key]) || 0);
    }
    // Dynamic detailed item keys (item_<desc>_<total>)
    if (key.startsWith("item_")) {
      // Find the matching detailed item in the DOM
      document.querySelectorAll("#tblInvItems tbody tr").forEach((tr) => {
        const desc = tr.querySelector(".item-desc")?.value?.trim() || "";
        const qty = parseFloat(tr.querySelector(".item-qty")?.value) || 0;
        const rate = parseFloat(tr.querySelector(".item-rate")?.value) || 0;
        const total = qty * rate;
        const itemKey = `item_${desc || "unnamed"}_${total}`;
        if (itemKey === key) {
          sum += total;
        }
      });
      return sum;
    }
    return sum + 0;
  }, 0);
}

const state = {
  owners: [],
  projects: [],
  contracts: [],
  invoices: [],
  socialInsurance: { contracts: {}, payments: {} },
  escalationsResponses: {},
  execPositions: [],
  deductionLibrary: [],
  sectorManagers: [],  // list of { id, displayName, username } from /api/projects/sector-managers
  filters: {
    ownerIds: [],
    projectIds: [],
    projectName: "",
    contractIds: [],
    escStatus: "",
    accPeriod: "",
  },
};

let filteredData = {
  owners: [],
  projects: [],
  contracts: [],
  invoices: [],
};

let chartInstances = {};

const globalFilterUI = {};

// Multi-filter instances for the Reports page
const repFilterUI = {};

const FILTER_ICONS = {
  owner:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  project:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="8" height="18"/><rect x="14" y="9" width="6" height="12"/><path d="M7 7h2M7 11h2M7 15h2"/></svg>',
  contract:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
};

let _applyFiltersTimer = null;
// state updates immediately; the heavy re-render of all pages is debounced
function scheduleApplyGlobalFilters(delay = 160) {
  clearTimeout(_applyFiltersTimer);
  _applyFiltersTimer = setTimeout(applyGlobalFilters, delay);
}

function initGlobalMultiFilters() {
  const make = (selectId, key, cfg) => {
    const el = document.getElementById(selectId);
    if (!el) return null;
    return createMultiFilter(el, {
      ...cfg,
      onChange: (ids) => {
        state.filters[key] = ids;
        if (key !== "contractIds") updateGlobalFilterDropdowns();
        scheduleApplyGlobalFilters();
      },
    });
  };

  globalFilterUI.owner = make("filterOwner", "ownerIds", {
    placeholder: "كل الملاك",
    searchPlaceholder: "ابحث عن مالك...",
    noItemsText: "لا يوجد ملاك",
    icon: FILTER_ICONS.owner,
  });
  globalFilterUI.project = make("filterProject", "projectIds", {
    placeholder: "كل المشروعات",
    searchPlaceholder: "ابحث عن مشروع...",
    noItemsText: "لا توجد مشروعات",
    icon: FILTER_ICONS.project,
  });
  globalFilterUI.contract = make("filterContract", "contractIds", {
    placeholder: "كل العقود",
    searchPlaceholder: "ابحث عن عقد...",
    noItemsText: "لا توجد عقود",
    icon: FILTER_ICONS.contract,
  });
  updateGlobalFilterDropdowns();
}

function initRepMultiFilters() {
  const makeRep = (selectId, cfg, onChange) => {
    const el = document.getElementById(selectId);
    if (!el) return null;
    return createMultiFilter(el, { ...cfg, onChange });
  };

  repFilterUI.escDesc = makeRep(
    "repEscDescFilter",
    {
      placeholder: "كل الأوصاف",
      searchPlaceholder: "ابحث عن وصف...",
      noItemsText: "لا توجد أوصاف",
    },
    () => { filterRepEscRows(); updateRepEscFooter(); }
  );

  repFilterUI.escStatus = makeRep(
    "repEscStatusFilter",
    {
      placeholder: "كل الحالات",
      searchPlaceholder: "ابحث عن حالة...",
      noItemsText: "لا توجد حالات",
    },
    () => { filterRepEscRows(); updateRepEscFooter(); }
  );
  if (repFilterUI.escStatus) {
    repFilterUI.escStatus.setOptions([
      { id: "لم يتم الرد",  label: "لم يتم الرد" },
      { id: "الرد جزئيًا", label: "الرد جزئيًا" },
      { id: "تم الرد",     label: "تم الرد" },
    ]);
  }

  repFilterUI.invPayStatus = makeRep(
    "repInvPaymentStatusFilter",
    {
      placeholder: "كل حالات الصرف",
      searchPlaceholder: "ابحث عن حالة...",
      noItemsText: "لا توجد حالات",
    },
    () => { filterRepInvRows(); updateRepInvFooter(); }
  );
  if (repFilterUI.invPayStatus) {
    repFilterUI.invPayStatus.setOptions([
      { id: "Pending", label: "معلق" },
      { id: "Paid",    label: "مدفوع" },
      { id: "Partial", label: "جزئي" },
    ]);
  }

  repFilterUI.invLastStatus = makeRep(
    "repInvLastStatusFilter",
    {
      placeholder: "كل حالات المستخلص",
      searchPlaceholder: "ابحث عن حالة...",
      noItemsText: "لا توجد حالات",
    },
    () => { filterRepInvRows(); updateRepInvFooter(); }
  );
  if (repFilterUI.invLastStatus) {
    repFilterUI.invLastStatus.setOptions([
      { id: "Draft",    label: "مسودة" },
      { id: "Review",   label: "مراجعة" },
      { id: "Approved", label: "معتمد" },
      { id: "Rejected", label: "مرفوض" },
    ]);
  }
}

// Presentation-only Chart.js defaults for the executive dashboard (RTL-aware
// legends/tooltips, consistent typography). Does not touch any data logic.
if (typeof Chart !== "undefined" && !Chart.__mcDefaultsApplied) {
  Chart.__mcDefaultsApplied = true;
  Chart.defaults.font.family =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Roboto, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#475569";
  Chart.defaults.plugins.legend.rtl = true;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.padding = 14;
  Chart.defaults.plugins.tooltip.rtl = true;
  Chart.defaults.plugins.tooltip.backgroundColor = "#0f172a";
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 6;
  Chart.defaults.plugins.tooltip.titleFont = { weight: "700" };
  Chart.defaults.animation.duration = 450;
}

/**
 * Returns today as YYYY-MM-DD using LOCAL time (no UTC shift).
 * Use this whenever you need "today" as a date string for forms or comparisons.
 */
function getTodayLocal() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function fmtNum(num, decimals = 2) {
  const val = parseFloat(num) || 0;
  return val.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Format a date string (YYYY-MM-DD or ISO) as DD/MM/YYYY for display.
// Input remains a real date string internally; only the visual output changes.
function fmtDisplayDate(dateStr) {
  if (!dateStr) return "-";
  const raw = String(dateStr).split(/[T ]/)[0].trim();
  if (!raw || raw.length < 8) return dateStr || "-";
  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  // YYYY-MM-DD
  const parts = raw.split("-");
  if (parts.length !== 3) return dateStr;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function fmtNumShort(num) {
  const val = Math.abs(parseFloat(num)) || 0;
  const sign = parseFloat(num) < 0 ? "-" : "";

  if (val >= 1000000000) {
    return sign + (val / 1000000000).toFixed(2) + " Bn";
  } else if (val >= 1000000) {
    return sign + (val / 1000000).toFixed(2) + " M";
  } else if (val >= 1000) {
    return sign + (val / 1000).toFixed(2) + " K";
  }
  return sign + fmtNum(val);
}

const SummaryEngine = {
  calculate(type, visibleElements) {
    if (type === "invoices") {
      let count = 0;
      let gross = 0;
      let net = 0;
      let paid = 0;
      let totalPaymentDays = 0;
      let paidCount = 0;

      visibleElements.forEach((inv) => {
        count++;
        const g = getInvoiceGross(inv);
        const n = getInvoiceNet(inv);
        const p = parseFloat(inv.paidAmount) || 0;
        gross += g;
        net += n;
        paid += p;

        if (inv.paymentDate && inv.date) {
          const d1 = new Date(inv.date);
          const d2 = new Date(inv.paymentDate);
          const diff = Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
          if (!isNaN(diff) && diff >= 0) {
            totalPaymentDays += diff;
            paidCount++;
          }
        }
      });

      const collectionRate = net > 0 ? Math.min(100, (paid / net) * 100) : 0;
      const avgPaymentDays =
        paidCount > 0 ? Math.round(totalPaymentDays / paidCount) : 0;

      return { count, gross, net, paid, collectionRate, avgPaymentDays };
    }

    if (type === "escalations") {
      let count = 0;
      let totalAmount = 0;
      let returnedAmount = 0;

      visibleElements.forEach((esc) => {
        count++;
        const amt = parseFloat(esc.amount) || 0;
        totalAmount += amt;
        const status = normalizeEscalationStatus(esc.responseStatus);

        if (status === ESC_STATUS_DONE) {
          returnedAmount += amt;
        } else if (status === ESC_STATUS_PARTIAL) {
          returnedAmount +=
            esc.returnedAmount !== undefined
              ? parseFloat(esc.returnedAmount)
              : amt * 0.5;
        }
      });

      const remainingAmount = Math.max(0, totalAmount - returnedAmount);
      const returnRate =
        totalAmount > 0 ? (returnedAmount / totalAmount) * 100 : 0;

      return {
        count,
        totalAmount,
        returnedAmount,
        remainingAmount,
        returnRate,
      };
    }
  },

  update(screenType) {
    const screens = screenType ? [screenType] : ["invoices", "escalations"];

    screens.forEach((type) => {
      if (type === "invoices") {
        const visibleInvoices = [];
        const rows = document.querySelectorAll("#tblInvoices tbody tr");
        rows.forEach((row) => {
          if (
            row.style.display !== "none" &&
            !row.querySelector("td[colspan]")
          ) {
            const id = row.getAttribute("data-id");
            const inv = state.invoices.find((x) => x.id === id);
            if (inv) visibleInvoices.push(inv);
          }
        });

        const metrics = this.calculate("invoices", visibleInvoices);

        const elCount = document.getElementById("invSummaryCount");
        if (elCount) elCount.innerText = fmtNum(metrics.count, 0);

        const elGross = document.getElementById("invSummaryGross");
        if (elGross) {
          elGross.innerText = fmtNumShort(metrics.gross);
          elGross.setAttribute("data-full", fmtNum(metrics.gross));
        }

        const elNet = document.getElementById("invSummaryNet");
        if (elNet) {
          elNet.innerText = fmtNumShort(metrics.net);
          elNet.setAttribute("data-full", fmtNum(metrics.net));
        }

        const elRate = document.getElementById("invSummaryCollectionRate");
        if (elRate) elRate.innerText = fmtNum(metrics.collectionRate, 1) + "%";

        const elAvg = document.getElementById("invSummaryAvgPaymentDays");
        if (elAvg) elAvg.innerText = fmtNum(metrics.avgPaymentDays, 0);

        const footCount = document.getElementById("invFootCount");
        if (footCount) footCount.innerText = fmtNum(metrics.count, 0);

        const footGross = document.getElementById("invFootGross");
        if (footGross) footGross.innerText = fmtNum(metrics.gross);

        const footNet = document.getElementById("invFootNet");
        if (footNet) footNet.innerText = fmtNum(metrics.net);

        const footAvg = document.getElementById("invFootAvgDays");
        if (footAvg) footAvg.innerText = fmtNum(metrics.avgPaymentDays, 0);
      }

      if (type === "escalations") {
        const visibleEscalations = [];
        const rows = document.querySelectorAll("#tblEscalations tbody tr");
        rows.forEach((row) => {
          if (
            row.style.display !== "none" &&
            !row.querySelector("td[colspan]")
          ) {
            const key = row.getAttribute("data-key");
            const amt = parseFloat(row.getAttribute("data-amt")) || 0;
            const statusCtrl = row.querySelector(".esc-status-ctrl");
            const status = normalizeEscalationStatus(
              statusCtrl ? statusCtrl.value : row.getAttribute("data-status"),
            );
            const retInput = row.querySelector(".esc-ret-ctrl");
            const retAmt = retInput
              ? parseFloat(retInput.value)
              : row.getAttribute("data-ret-amt")
                ? parseFloat(row.getAttribute("data-ret-amt"))
                : undefined;
            visibleEscalations.push({
              key,
              amount: amt,
              responseStatus: status,
              returnedAmount: retAmt,
            });
          }
        });

        const metrics = this.calculate("escalations", visibleEscalations);

        const elCount = document.getElementById("escSummaryCount");
        if (elCount) elCount.innerText = fmtNum(metrics.count, 0);

        const elTotal = document.getElementById("escSummaryTotalAmount");
        if (elTotal) {
          elTotal.innerText = fmtNumShort(metrics.totalAmount);
          elTotal.setAttribute("data-full", fmtNum(metrics.totalAmount));
        }

        const elRet = document.getElementById("escSummaryReturnedAmount");
        if (elRet) {
          elRet.innerText = fmtNumShort(metrics.returnedAmount);
          elRet.setAttribute("data-full", fmtNum(metrics.returnedAmount));
        }

        const elRem = document.getElementById("escSummaryRemainingAmount");
        if (elRem) {
          elRem.innerText = fmtNumShort(metrics.remainingAmount);
          elRem.setAttribute("data-full", fmtNum(metrics.remainingAmount));
        }

        const elRate = document.getElementById("escSummaryReturnRate");
        if (elRate) elRate.innerText = fmtNum(metrics.returnRate, 1) + "%";

        const footCount = document.getElementById("escFootCount");
        if (footCount) footCount.innerText = fmtNum(metrics.count, 0);

        const footTotal = document.getElementById("escFootTotalAmount");
        if (footTotal) footTotal.innerText = fmtNum(metrics.totalAmount);

        const footReturned = document.getElementById("escFootReturned");
        if (footReturned)
          footReturned.innerText = fmtNum(metrics.returnedAmount);

        const footRemaining = document.getElementById("escFootRemaining");
        if (footRemaining)
          footRemaining.innerText = fmtNum(metrics.remainingAmount);

        const footRate = document.getElementById("escFootReturnRate");
        if (footRate) footRate.innerText = fmtNum(metrics.returnRate, 1) + "%";
      }
    });
  },
};

/* ================================================================
 * AUTHENTICATION & SESSION (backend-enforced)
 * ================================================================ */
const AUTH_STORAGE_KEY = "erp_auth_session";
const TOKEN_KEY = "erp_auth_token";

const DEFAULT_PERMISSIONS = {
  dashboard: ["view"],
  owners: ["view", "create", "edit", "delete"],
  projects: ["view", "create", "edit", "delete"],
  contracts: ["view", "create", "edit", "delete"],
  invoices: ["view", "create", "edit", "delete", "export"],
  execPosition: ["view", "create", "edit", "delete"],
  costControl: ["view", "create", "edit", "delete"],
  escalations: ["view", "edit"],
  socialInsurance: ["view", "edit"],
  reports: ["view", "export"],
  importExport: ["view", "export", "manage"],
  accounts: ["view", "manage"],
};

const MODULE_LABELS = {
  dashboard: "لوحة المتابعة",
  owners: "المالك",
  projects: "المشروعات",
  contracts: "العقود",
  invoices: "المستخلصات",
  execPosition: "الموقف التنفيذي",
  costControl: "مراقبة التكاليف",
  escalations: "التعليات",
  socialInsurance: "التأمينات الاجتماعية",
  reports: "التقارير",
  importExport: "التصدير والاستيراد",
  accounts: "الحسابات والصلاحيات",
};

const PERM_LABELS = {
  view: "عرض",
  create: "إنشاء",
  edit: "تعديل",
  delete: "حذف",
  export: "تصدير",
  manage: "إدارة",
};

const PAGE_TO_MODULE = {
  dashboardView: "dashboard",
  ownersView: "owners",
  projectsView: "projects",
  contractsView: "contracts",
  invoicesView: "invoices",
  execPositionView: "execPosition",
  costControlView: "costControl",
  escalationsView: "escalations",
  socialInsuranceView: "socialInsurance",
  reportsView: "reports",
  importExportView: "importExport",
  accountsView: "accounts",
};

function getSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function setSessionFromLogin(loginResp) {
  const session = {
    userId: loginResp.userId || loginResp.UserId,
    username: loginResp.username || loginResp.Username,
    displayName: loginResp.displayName || loginResp.DisplayName,
    role: loginResp.role || loginResp.Role,
    email: loginResp.email || loginResp.Email,
    status: loginResp.status || loginResp.Status || "Active",
    permissions: loginResp.permissions || loginResp.Permissions || {},
    loginAt: Date.now(),
  };
  // normalize permission keys to camelCase-ish expected by frontend
  const perms = {};
  Object.keys(session.permissions || {}).forEach((k) => {
    perms[k] = session.permissions[k];
  });
  session.permissions = perms;
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  const token = loginResp.token || loginResp.Token || "";
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch (_) {}
  return session;
}

function clearSession() {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    // امسح أي بقايا قديمة من localStorage
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("auth_session");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("erp_auth_session");
    localStorage.removeItem("erp_auth_token");
  } catch (_) {
    /* ignore */
  }
}

function currentUser() {
  return getSession();
}

function hasPermission(module, action) {
  const user = currentUser();
  if (!user) return false;
  if (String(user.role).toLowerCase() === "admin") return true;
  const perms = user.permissions?.[module];
  return (
    Array.isArray(perms) &&
    perms.some((a) => String(a).toLowerCase() === String(action).toLowerCase())
  );
}

function canAccessPage(pageId) {
  const mod = PAGE_TO_MODULE[pageId];
  if (!mod) return true;
  return hasPermission(mod, "view");
}

function showLogin() {
  const overlay = document.getElementById("login-overlay");
  const app = document.getElementById("app-wrapper");
  if (overlay) overlay.classList.remove("hidden");
  if (app) app.style.display = "none";
}

function showApp() {
  const overlay = document.getElementById("login-overlay");
  const app = document.getElementById("app-wrapper");
  if (overlay) overlay.classList.add("hidden");
  if (app) app.style.display = "";
  const u = currentUser();
  const nameEl = document.getElementById("headerUserName");
  if (nameEl && u) nameEl.textContent = u.displayName || u.username;
  const chip = document.getElementById("sidebarUserChip");
  if (chip && u) {
    const label = (u.displayName || u.username || "م").trim();
    chip.textContent = label.charAt(0);
    chip.title = label;
  }
  applyPermissionUI();
}

/** Hide/disable write actions based on permissions (UX layer; backend is authoritative). */
function applyPermissionUI() {
  document.querySelectorAll(".sidebar-link[data-page]").forEach((link) => {
    const page = link.getAttribute("data-page");
    const allowed = canAccessPage(page);
    link.style.display = allowed ? "" : "none";
    const item = link.closest(".sidebar-item");
    if (item) item.style.display = allowed ? "" : "none";
  });

  // Map common action buttons to module+action
  const rules = [
    // Owners
    {
      sel: '#btnAddOwner, [data-action="add-owner"]',
      mod: "owners",
      act: "create",
    },
    { sel: "#btnSaveOwner", mod: "owners", act: "edit" }, // create/edit handled at click too
    // Projects
    {
      sel: '#btnAddProject, [data-action="add-project"]',
      mod: "projects",
      act: "create",
    },
    // Contracts
    {
      sel: '#btnAddContract, [data-action="add-contract"]',
      mod: "contracts",
      act: "create",
    },
    // Invoices
    {
      sel: '#btnQuickInvoice, #btnAddInvoice, [data-action="add-invoice"]',
      mod: "invoices",
      act: "create",
    },
    // Import/Export
    {
      sel: "#btnExportFullExcel, #btnExportJSON",
      mod: "importExport",
      act: "export",
    },
    {
      sel: "#fileImportFullExcel, #fileImportMasterData, #fileImportJSON",
      mod: "importExport",
      act: "manage",
    },
    // Accounts
    { sel: "#btnAddUser, #btnSavePermissions", mod: "accounts", act: "manage" },
    // Bulk delete
    { sel: "#btnDeleteAllOwners", mod: "owners", act: "delete" },
  ];

  rules.forEach(({ sel, mod, act }) => {
    document.querySelectorAll(sel).forEach((el) => {
      const ok = hasPermission(mod, act);
      if (el.tagName === "INPUT" && el.type === "file") {
        const label = el.closest("label");
        if (label) label.style.display = ok ? "" : "none";
        el.disabled = !ok;
      } else if (el.tagName === "BUTTON" || el.tagName === "A") {
        el.style.display = ok ? "" : "none";
        el.disabled = !ok;
      } else {
        el.style.display = ok ? "" : "none";
      }
    });
  });

  // Generic data-permission attributes: data-perm-module + data-perm-action
  document
    .querySelectorAll("[data-perm-module][data-perm-action]")
    .forEach((el) => {
      const mod = el.getAttribute("data-perm-module");
      const act = el.getAttribute("data-perm-action");
      const ok = hasPermission(mod, act);
      el.style.display = ok ? "" : "none";
      if ("disabled" in el) el.disabled = !ok;
    });

  // Table row action buttons with classes used across the app
  document
    .querySelectorAll(".btn-edit, .btn-delete, .action-edit, .action-delete")
    .forEach((btn) => {
      // Infer module from active page
      const active = document.querySelector(".page-view.active");
      if (!active) return;
      const pageId = active.id;
      const mod = PAGE_TO_MODULE[pageId];
      if (!mod) return;
      const isDelete =
        btn.classList.contains("btn-delete") ||
        btn.classList.contains("action-delete");
      const act = isDelete ? "delete" : "edit";
      const ok = hasPermission(mod, act);
      btn.style.display = ok ? "" : "none";
      btn.disabled = !ok;
    });
}

async function handleLogin(username, password) {
  try {
    const resp = await erpApi.login(username, password);
    setSessionFromLogin(resp);
    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : "فشل تسجيل الدخول";
    return {
      ok: false,
      message:
        msg.includes("غير") || msg.includes("صحيح")
          ? msg
          : "اسم المستخدم أو كلمة المرور غير صحيحة",
    };
  }
}

async function handleLogout() {
  try {
    if (typeof erpApi !== "undefined" && erpApi.logout) await erpApi.logout();
  } catch (_) {
    /* offline / token already invalid */
  }
  clearSession();
  showLogin();
}

function initAuthUI() {
  const form = document.getElementById("loginForm");
  const errEl = document.getElementById("loginError");
  const btn = document.getElementById("btnLogin");
  const togglePass = document.getElementById("btnTogglePassword");
  const passInput = document.getElementById("loginPassword");

  if (togglePass && passInput) {
    togglePass.addEventListener("click", () => {
      const isPass = passInput.type === "password";
      passInput.type = isPass ? "text" : "password";
      togglePass.textContent = isPass ? "🙈" : "👁";
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (btn) {
        btn.disabled = true;
        btn.textContent = "جاري الدخول...";
      }
      if (errEl) {
        errEl.classList.remove("visible");
        errEl.textContent = "";
      }
      const username = (
        document.getElementById("loginUsername")?.value || ""
      ).trim();
      const password = document.getElementById("loginPassword")?.value || "";
      handleLogin(username, password).then((result) => {
        if (result.ok) {
          showApp();
          (async () => {
            try {
              const loadedFromApi = await loadFromBackendOrLocal();
              ensureSocialInsuranceState();
              ensureDeductionLibraryInitialized();
              syncAllSocialInsuranceInvoices();
              populateDropdowns();
              applyGlobalFilters();
              initFlatpickr();
              if (!loadedFromApi) clearDataState();
              restoreLastActivePage();
              applyPermissionUI();
            } catch (err) {
              console.error("Post-login load failed:", err);
            }
          })();
        } else {
          if (errEl) {
            errEl.textContent = result.message;
            errEl.classList.add("visible");
          }
        }
        if (btn) {
          btn.disabled = false;
          btn.textContent = "دخول";
        }
      });
    });
  }

  const logoutBtn = document.getElementById("btnLogout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => handleLogout());
  }
}

/** Guard write operations before they hit the API (extra safety + UX). */
function assertCan(module, action, friendlyName) {
  if (hasPermission(module, action)) return true;
  alert(
    friendlyName
      ? `ليس لديك صلاحية: ${friendlyName}`
      : "ليس لديك صلاحية لتنفيذ هذه العملية",
  );
  return false;
}

/* ================================================================
 * SIDEBAR COLLAPSE
 * ================================================================ */
const SIDEBAR_COLLAPSED_KEY = "erp_sidebar_collapsed";

function isSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

function setSidebarCollapsed(collapsed) {
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("sidebar-collapsed", !!collapsed);
  document.body.classList.toggle("sidebar-is-collapsed", !!collapsed);
  // Keep toggle accessible: when collapsed place it in the footer; when expanded back in brand
  const btn = document.getElementById("btnSidebarToggle");
  const brand = sidebar.querySelector(".sidebar-brand");
  const footer = sidebar.querySelector(".sidebar-footer");
  if (btn && brand && footer) {
    if (collapsed) {
      if (btn.parentElement !== footer)
        footer.insertBefore(btn, footer.firstChild);
    } else {
      if (btn.parentElement !== brand)
        brand.insertBefore(btn, brand.firstChild);
    }
  }
}

// function initSidebarToggle() {
//   setSidebarCollapsed(isSidebarCollapsed());
//   const btn = document.getElementById('btnSidebarToggle');
//   if (btn) {
//     btn.addEventListener('click', () => {
//       setSidebarCollapsed(!isSidebarCollapsed());
//     });
//   }
// }

function initSidebarToggle() {
  setSidebarCollapsed(isSidebarCollapsed());

  const btnDesktop = document.getElementById("btnSidebarToggle");
  if (btnDesktop) {
    btnDesktop.addEventListener("click", () => {
      // On mobile drawer mode: close drawer instead of rail-collapse
      if (window.matchMedia("(max-width: 767.98px)").matches) {
        closeMobileSidebar();
        return;
      }
      setSidebarCollapsed(!isSidebarCollapsed());
    });
  }

  // Mobile menu button in header
  const btnMobile = document.getElementById("btnMobileMenu");
  if (btnMobile) {
    btnMobile.addEventListener("click", () => {
      if (document.body.classList.contains("sidebar-mobile-open")) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });
  }

  // Close button inside sidebar (mobile drawer)
  const btnClose = document.getElementById("btnSidebarClose");
  if (btnClose) {
    btnClose.addEventListener("click", closeMobileSidebar);
  }

  // Backdrop click
  ensureSidebarBackdrop();
  const backdrop = document.getElementById("sidebarBackdrop");
  if (backdrop) {
    backdrop.addEventListener("click", closeMobileSidebar);
  }

  // Close drawer after navigating to a page
  document.querySelectorAll(".sidebar-link[data-page]").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 767.98px)").matches) {
        closeMobileSidebar();
      }
    });
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileSidebar();
  });
}

function ensureSidebarBackdrop() {
  if (document.getElementById("sidebarBackdrop")) return;
  const el = document.createElement("div");
  el.id = "sidebarBackdrop";
  el.className = "sidebar-backdrop";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
}

function openMobileSidebar() {
  ensureSidebarBackdrop();
  document.body.classList.add("sidebar-mobile-open");
  document.documentElement.style.overflow = "hidden";
  const backdrop = document.getElementById("sidebarBackdrop");
  if (backdrop) {
    backdrop.classList.add("is-visible");
    backdrop.setAttribute("aria-hidden", "false");
  }
}

function closeMobileSidebar() {
  document.body.classList.remove("sidebar-mobile-open");
  document.documentElement.style.overflow = "";
  const backdrop = document.getElementById("sidebarBackdrop");
  if (backdrop) {
    backdrop.classList.remove("is-visible");
    backdrop.setAttribute("aria-hidden", "true");
  }
}

function initFiltersToggle() {
  const btn = document.getElementById("btnToggleFilters");
  const panel = document.getElementById("filtersPanelInner");
  if (!btn || !panel) return;
  if (window.matchMedia("(max-width: 767.98px)").matches) {
    panel.classList.add("is-collapsed");
    btn.setAttribute("aria-expanded", "false");
  }
  btn.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("is-collapsed");
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });
}
/* ================================================================
 * ACCOUNTS UI (backend users API) — full user management
 * ================================================================ */
let _selectedUserId = null;
let _usersCache = [];
let _usersSearch = "";

function roleLabel(role) {
  const r = String(role || "");
  if (r.toLowerCase() === "admin" || r.toLowerCase() === "administrator")
    return "مدير النظام";
  if (r.toLowerCase() === "viewer") return "عرض فقط";
  return "مستخدم";
}

function statusLabel(status) {
  return String(status).toLowerCase() === "active" ? "نشط" : "غير نشط";
}

async function renderAccountsPage() {
  const tbody = document.querySelector("#tblUsers tbody");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">جاري التحميل...</td></tr>';
  try {
    _usersCache = (await erpApi.listUsers()) || [];
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">تعذر تحميل المستخدمين: ${err.message || err}</td></tr>`;
    return;
  }
  let list = _usersCache.slice();
  if (_usersSearch) {
    const q = _usersSearch.toLowerCase();
    list = list.filter((u) => {
      const blob = [
        u.username,
        u.Username,
        u.displayName,
        u.DisplayName,
        u.email,
        u.Email,
        u.role,
        u.Role,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }
  tbody.innerHTML = "";
  if (!list.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;color:var(--gray);padding:1.5rem;">لا يوجد مستخدمون</td></tr>';
  }
  list.forEach((u) => {
    const id = u.id || u.Id;
    const status = u.status || u.Status || "";
    const statusCls =
      String(status).toLowerCase() === "active"
        ? "user-status-active"
        : "user-status-inactive";
    const uname = String(u.username || u.Username || "").toLowerCase();
    const isProtectedAdmin = id === "u-admin" || uname === "admin";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.username || u.Username || ""}</td>
      <td>${u.displayName || u.DisplayName || "—"}</td>
      <td>${u.email || u.Email || "—"}</td>
      <td>${roleLabel(u.role || u.Role)}</td>
      <td class="${statusCls}">${statusLabel(status)}</td>
      <td>${u.createdAt || u.CreatedAt || "—"}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-select-user="${id}">صلاحيات</button>
          <button type="button" class="btn-icon btn-icon-edit" title="تعديل" data-edit-user="${id}">${ICON_BTN_EDIT}</button>
          <button type="button" class="btn btn-danger btn-sm" data-toggle-status="${id}">${String(status).toLowerCase() === "active" ? "إيقاف" : "تفعيل"}</button>
          ${isProtectedAdmin ? "" : `<button type="button" class="btn-icon btn-icon-delete" title="حذف المستخدم" data-delete-user="${id}">${ICON_BTN_DELETE}</button>`}
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-select-user]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _selectedUserId = btn.getAttribute("data-select-user");
      renderPermissionsForUser(_selectedUserId);
    });
  });
  tbody.querySelectorAll("[data-edit-user]").forEach((btn) => {
    btn.addEventListener("click", () =>
      openUserModal(btn.getAttribute("data-edit-user")),
    );
  });
  tbody.querySelectorAll("[data-toggle-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!assertCan("accounts", "manage", "تغيير حالة المستخدم")) return;
      const id = btn.getAttribute("data-toggle-status");
      const u = _usersCache.find((x) => (x.id || x.Id) === id);
      if (!u) return;
      const cur = String(u.status || u.Status || "Active");
      const next = cur.toLowerCase() === "active" ? "Inactive" : "Active";
      try {
        await erpApi.updateUser(id, { status: next });
        await renderAccountsPage();
      } catch (err) {
        alert("تعذر تحديث الحالة: " + (err.message || err));
      }
    });
  });

  tbody.querySelectorAll("[data-delete-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!assertCan("accounts", "manage", "حذف المستخدم")) return;
      const id = btn.getAttribute("data-delete-user");
      const u = _usersCache.find((x) => (x.id || x.Id) === id);
      if (!u) return;
      const uname = String(u.username || u.Username || "").toLowerCase();
      if (id === "u-admin" || uname === "admin") {
        alert("لا يمكن حذف حساب مدير النظام الأساسي.");
        return;
      }
      const display =
        u.displayName || u.DisplayName || u.username || u.Username || id;
      const ok = await erpNotify.showConfirm(
        `هل أنت متأكد من حذف المستخدم «${display}»؟ لا يمكن التراجع عن هذا الإجراء.`,
        {
          title: "تأكيد حذف المستخدم",
          confirmText: "حذف",
          cancelText: "إلغاء",
          danger: true,
        },
      );
      if (!ok) return;
      try {
        await erpApi.deleteUser(id);
        if (_selectedUserId === id) {
          _selectedUserId = null;
        }
        alert("تم حذف المستخدم بنجاح");
        await renderAccountsPage();
      } catch (err) {
        alert("تعذر حذف المستخدم: " + (err.message || err));
      }
    });
  });

  const me = currentUser();
  if (me) {
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v || "—";
    };
    set("accUsername", me.username);
    set("accDisplayName", me.displayName);
    set("accEmail", me.email);
    set("accRole", roleLabel(me.role));
    set("accStatus", statusLabel(me.status));
  }
  if (!_selectedUserId && me) _selectedUserId = me.userId;
  if (_selectedUserId) renderPermissionsForUser(_selectedUserId);
  applyPermissionUI();
}

function renderPermissionsForUser(userId) {
  const user = (_usersCache || []).find((u) => (u.id || u.Id) === userId);
  const grid = document.getElementById("permissionsGrid");
  if (!grid || !user) return;
  const role = user.role || user.Role;
  const permissions = user.permissions || user.Permissions || {};
  grid.innerHTML = "";
  Object.keys(MODULE_LABELS).forEach((mod) => {
    const card = document.createElement("div");
    card.className = "permission-module";
    const available = DEFAULT_PERMISSIONS[mod] || ["view"];
    const current = permissions[mod] || [];
    const isAdmin =
      String(role).toLowerCase() === "admin" ||
      String(role).toLowerCase() === "administrator";
    const checks = available
      .map((p) => {
        const checked = current
          .map(String)
          .map((x) => x.toLowerCase())
          .includes(p.toLowerCase())
          ? "checked"
          : "";
        const disabled = isAdmin ? "disabled" : "";
        return `<label><input type="checkbox" data-perm-mod="${mod}" data-perm="${p}" ${checked} ${disabled}/> ${PERM_LABELS[p] || p}</label>`;
      })
      .join("");
    card.innerHTML = `<h4>${MODULE_LABELS[mod]}${isAdmin ? ' <span style="font-size:.75rem;color:var(--gray)">(مدير — كامل)</span>' : ""}</h4><div class="permission-checks">${checks}</div>`;
    grid.appendChild(card);
  });
}

async function savePermissionsFromUI() {
  if (!_selectedUserId) return;
  if (!assertCan("accounts", "manage", "إدارة الحسابات")) return;
  const user = (_usersCache || []).find(
    (u) => (u.id || u.Id) === _selectedUserId,
  );
  if (!user) return;
  const role = user.role || user.Role;
  if (
    String(role).toLowerCase() === "admin" ||
    String(role).toLowerCase() === "administrator"
  ) {
    alert("حساب المدير يمتلك كل الصلاحيات ولا يمكن تعديلها.");
    return;
  }
  const perms = {};
  document
    .querySelectorAll("#permissionsGrid input[type=checkbox]")
    .forEach((cb) => {
      const mod = cb.getAttribute("data-perm-mod");
      const p = cb.getAttribute("data-perm");
      if (!perms[mod]) perms[mod] = [];
      if (cb.checked) perms[mod].push(p);
    });
  try {
    await erpApi.updateUser(_selectedUserId, { permissions: perms });
    await renderAccountsPage();
    const me = currentUser();
    if (me && me.userId === _selectedUserId) {
      me.permissions = perms;
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(me));
      applyPermissionUI();
    }
    alert("تم حفظ الصلاحيات بنجاح");
  } catch (err) {
    alert("فشل حفظ الصلاحيات: " + (err.message || err));
  }
}

function openUserModal(editId) {
  if (!assertCan("accounts", "manage", "إدارة المستخدمين")) return;
  const modal = document.getElementById("modalUser");
  const err = document.getElementById("userFormError");
  if (err) {
    err.style.display = "none";
    err.textContent = "";
  }
  document.getElementById("userEditId").value = editId || "";
  const isEdit = !!editId;
  document.getElementById("lblUserModal").textContent = isEdit
    ? "تعديل مستخدم"
    : "إضافة مستخدم";
  document.getElementById("userPasswordRequired").style.display = isEdit
    ? "none"
    : "";
  document.getElementById("userPassword2Required").style.display = isEdit
    ? "none"
    : "";
  document.getElementById("userPassword").value = "";
  document.getElementById("userPassword2").value = "";
  document.getElementById("userUsername").disabled = isEdit;

  if (isEdit) {
    const u = (_usersCache || []).find((x) => (x.id || x.Id) === editId);
    if (!u) return;
    document.getElementById("userUsername").value =
      u.username || u.Username || "";
    document.getElementById("userDisplayName").value =
      u.displayName || u.DisplayName || "";
    document.getElementById("userEmail").value = u.email || u.Email || "";
    document.getElementById("userRole").value = u.role || u.Role || "User";
    document.getElementById("userStatus").value =
      (u.status || u.Status || "Active") === "Active" ? "Active" : "Inactive";
  } else {
    document.getElementById("userUsername").value = "";
    document.getElementById("userDisplayName").value = "";
    document.getElementById("userEmail").value = "";
    document.getElementById("userRole").value = "Viewer";
    document.getElementById("userStatus").value = "Active";
  }
  if (modal) modal.classList.add("active");
}

function closeUserModal() {
  const modal = document.getElementById("modalUser");
  if (modal) modal.classList.remove("active");
}

async function saveUserFromModal() {
  if (!assertCan("accounts", "manage", "إدارة المستخدمين")) return;
  const errEl = document.getElementById("userFormError");
  const showErr = (msg) => {
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = "block";
    } else alert(msg);
  };
  const editId = document.getElementById("userEditId").value;
  const username = (document.getElementById("userUsername").value || "").trim();
  const displayName = (
    document.getElementById("userDisplayName").value || ""
  ).trim();
  const email = (document.getElementById("userEmail").value || "").trim();
  const password = document.getElementById("userPassword").value || "";
  const password2 = document.getElementById("userPassword2").value || "";
  const role = document.getElementById("userRole").value || "User";
  const status = document.getElementById("userStatus").value || "Active";

  if (!username) return showErr("يرجى إدخال اسم المستخدم");
  if (!displayName) return showErr("يرجى إدخال الاسم الكامل");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return showErr("يرجى إدخال بريد إلكتروني صحيح");
  if (!editId) {
    if (!password || password.length < 4)
      return showErr("كلمة المرور مطلوبة ويجب ألا تقل عن 4 أحرف");
    if (password !== password2)
      return showErr("كلمة المرور وتأكيد كلمة المرور غير متطابقين");
  } else if (password) {
    if (password.length < 4)
      return showErr("كلمة المرور يجب ألا تقل عن 4 أحرف");
    if (password !== password2)
      return showErr("كلمة المرور وتأكيد كلمة المرور غير متطابقين");
  }

  try {
    if (editId) {
      const payload = { displayName, email, role, status };
      if (password) payload.password = password;
      // Role change applies default permissions server-side when permissions not sent
      await erpApi.updateUser(editId, payload);
    } else {
      await erpApi.createUser({ username, password, displayName, email, role });
    }
    closeUserModal();
    await renderAccountsPage();
    alert(editId ? "تم تحديث المستخدم بنجاح" : "تم إنشاء المستخدم بنجاح");
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("موجود") || msg.includes("مستخدم")) showErr(msg);
    else showErr(msg || "حدث خطأ أثناء حفظ المستخدم، يرجى المحاولة مرة أخرى");
  }
}

function initAccountsUI() {
  const saveBtn = document.getElementById("btnSavePermissions");
  if (saveBtn)
    saveBtn.addEventListener("click", () => {
      savePermissionsFromUI();
    });
  const addBtn = document.getElementById("btnAddUser");
  if (addBtn) addBtn.addEventListener("click", () => openUserModal(null));
  const saveUser = document.getElementById("btnSaveUser");
  if (saveUser) saveUser.addEventListener("click", () => saveUserFromModal());
  document.querySelectorAll("[data-close-user]").forEach((el) => {
    el.addEventListener("click", closeUserModal);
  });
  document.querySelectorAll("[data-toggle-pass]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-toggle-pass");
      const input = document.getElementById(id);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
    });
  });
  const search = document.getElementById("searchUsers");
  if (search) {
    search.addEventListener("input", () => {
      _usersSearch = search.value.trim();
      renderAccountsPage();
    });
  }
  // Close modal on overlay click
  const modal = document.getElementById("modalUser");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeUserModal();
    });
  }
}

async function enforceAuthOnBoot() {
  const session = getSession();
  let token = null;
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch (_) {
    token = null;
  }

  if (!session || !token) {
    clearSession();
    showLogin();
    return false;
  }

  try {
    const me = await erpApi.me();
    if (!me) {
      clearSession();
      showLogin();
      return false;
    }
    try {
      const normalized = {
        userId: me.userId || me.UserId || session.userId,
        username: me.username || me.Username || session.username,
        displayName: me.displayName || me.DisplayName || session.displayName,
        role: me.role || me.Role || session.role,
        email: me.email || me.Email || session.email,
        status: me.status || me.Status || session.status || "Active",
        permissions:
          me.permissions || me.Permissions || session.permissions || {},
        loginAt: session.loginAt || Date.now(),
      };
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
    } catch (_) {
      /* ignore */
    }
    return true;
  } catch (err) {
    clearSession();
    showLogin();
    return false;
  }
}

async function initERP() {
  initAuthUI();
  initSidebarToggle();
  initFiltersToggle();
  initAccountsUI();
  initCentralizedEventListeners();

  const ok = await enforceAuthOnBoot();
  if (!ok) return;

  showApp();
  restoreLastActivePage();
  const loadedFromApi = await loadFromBackendOrLocal();
  await loadSectorManagers();
  ensureSocialInsuranceState();
  ensureDeductionLibraryInitialized();
  syncAllSocialInsuranceInvoices();
  populateDropdowns();
  applyGlobalFilters();
  initFlatpickr();
  if (!loadedFromApi) clearDataState();
}

async function loadSectorManagers() {
  try {
    const managers = await erpApi.projects.getSectorManagers();
    state.sectorManagers = Array.isArray(managers)
      ? managers.map((manager) => ({
          ...manager,
          id: String(manager.id ?? manager.Id ?? ""),
          displayName:
            manager.displayName ?? manager.DisplayName ?? manager.name ?? manager.Name ?? "",
        }))
      : [];
  } catch (err) {
    console.warn("Could not load sector managers:", err);
    state.sectorManagers = [];
  }
}

async function loadFromBackendOrLocal() {
  try {
    const remote = await erpApi.bootstrap();
    apiOnline = true;
    applyBootstrapToState(remote || {});
    return true;
  } catch (error) {
    apiOnline = false;
    clearDataState();
    console.error(
      "ERP API unavailable; no local/browser fallback is allowed:",
      error,
    );
    // Expired/invalid token → force re-login
    if (error && (error.status === 401 || error.status === 403)) {
      clearSession();
      showLogin();
    }
    return false;
  }
}

function clearDataState() {
  state.owners = [];
  state.projects = [];
  state.contracts = [];
  state.invoices = [];
  state.execPositions = [];
  state.escalationsResponses = {};
  state.socialInsurance = { contracts: {}, payments: {} };
  state.deductionLibrary = [];
}
function applyBootstrapToState(remote) {
  state.owners = Array.isArray(remote?.owners) ? remote.owners : [];
  state.projects = (Array.isArray(remote?.projects) ? remote.projects : []).map(
    (p) => ({
      ...p,
      id: p.id ?? p.Id ?? "",
      ownerId: p.ownerId ?? p.OwnerId ?? "",
      name: p.name ?? p.Name ?? "",
      // Normalize sectorManagerId to string so it matches state.sectorManagers[].id
      sectorManagerId: p.sectorManagerId != null ? String(p.sectorManagerId) : null,
    }),
  );
  state.contracts = (
    Array.isArray(remote?.contracts) ? remote.contracts : []
  ).map((c) => ({
    ...c,
    id: c.id ?? c.Id ?? "",
    projectId: c.projectId ?? c.ProjectId ?? "",
    name: c.name ?? c.Name ?? "",
    amount: parseFloat(c.amount ?? c.Amount) || 0,
    modifiedAmount: parseFloat(c.modifiedAmount ?? c.ModifiedAmount) || 0,
    voAmount: parseFloat(c.voAmount ?? c.VoAmount) || 0,
    claimsAmount: parseFloat(c.claimsAmount ?? c.ClaimsAmount) || 0,
    vatAmount: parseFloat(c.vatAmount ?? c.VatAmount) || 0,
    signDate: c.signDate ?? c.SignDate ?? null,
    contractDuration: parseInt(c.contractDuration ?? c.ContractDuration) || 0,
    endDate: c.endDate ?? c.EndDate ?? null,
  }));
  state.invoices = Array.isArray(remote?.invoices) ? remote.invoices : [];
  state.deductionLibrary = Array.isArray(remote?.deductionLibrary)
    ? remote.deductionLibrary
    : [];
  state.execPositions = Array.isArray(remote?.execPositions)
    ? remote.execPositions
    : [];

  const escalationMap = {};
  (remote?.escalations || []).forEach((item) => {
    if (item?.invoiceDeductionId) {
      escalationMap[item.invoiceDeductionId] = {
        responseStatus: normalizeEscalationStatus(item.responseStatus),
        responseDate: item.responseDate || "",
        returnedAmount: parseFloat(item.returnedAmount) || 0,
      };
    }
  });
  state.escalationsResponses = escalationMap;

  const socialContracts = {};
  (remote?.socialInsuranceContracts || []).forEach((item) => {
    if (item?.contractId) {
      const cleaned = { ...item, id: item.contractId };
      // Filter out invalid/default dates from the API
      if (
        cleaned.objectionDate === "1970-01-01" ||
        cleaned.objectionDate === "0001-01-01"
      )
        cleaned.objectionDate = null;
      if (
        cleaned.openingDate === "1970-01-01" ||
        cleaned.openingDate === "0001-01-01"
      )
        cleaned.openingDate = null;
      socialContracts[item.contractId] = cleaned;
    }
  });
  const socialPayments = {};
  (remote?.socialInsurancePayments || []).forEach((item) => {
    if (item?.invoiceId)
      socialPayments[item.invoiceId] = { ...item, id: item.invoiceId };
  });
  state.socialInsurance = {
    contracts: socialContracts,
    payments: socialPayments,
  };

  const deductionLibrary = Array.isArray(remote?.deductionLibrary)
    ? remote.deductionLibrary
    : [];
}

/* ---- Bootstrap normalization helpers ---- */
/** Ensure a value is a string (Excel may convert phone/id to a number). */
function _str(v) {
  if (v === null || v === undefined) return null;
  return String(v);
}
/** Ensure a value is a decimal number. */
function _dec(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
/** Ensure a value is an int. */
function _int(v) {
  return Math.round(_dec(v));
}
/** Ensure a value is a boolean. */
function _bool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string")
    return v.toLowerCase() === "true" || v === "1" || v === "yes";
  return Boolean(v);
}

function normalizeBootstrapPayload(raw) {
  const owners = (raw.owners || []).map((o) => ({
    id: _str(o.id),
    name: _str(o.name),
    phone: _str(o.phone),
    email: _str(o.email),
  }));
  const projects = (raw.projects || []).map((p) => ({
    id: _str(p.id),
    ownerId: _str(p.ownerId),
    name: _str(p.name),
    startDate: p.startDate || null,
    status: _str(p.status),
    sectorManagerId: _str(p.sectorManagerId),
  }));
  const contracts = (raw.contracts || []).map((c) => ({
    id: _str(c.id),
    projectId: _str(c.projectId),
    name: _str(c.name),
    amount: _dec(c.amount),
    modifiedAmount: _dec(c.modifiedAmount),
    voAmount: _dec(c.voAmount),
    claimsAmount: _dec(c.claimsAmount),
    vatAmount: _dec(c.vatAmount),
    paymentTerms: _int(c.paymentTerms),
    signDate: c.signDate || null,
    contractDuration: _int(c.contractDuration),
    endDate: c.endDate || null,
    status: _str(c.status),
  }));
  const invoices = (raw.invoices || []).map(normalizeInvoiceForApi);
  const execPositions = (raw.execPositions || []).map((ep) => ({
    id: _str(ep.id),
    contractId: _str(ep.contractId),
    versionNumber: _int(ep.versionNumber),
    date: ep.date || null,
    user: _str(ep.user),
    workVolume: _dec(ep.workVolume),
    variationOrders: _dec(ep.variationOrders),
    materials: _dec(ep.materials),
    claims: _dec(ep.claims),
    vat: _dec(ep.vat),
    totalAmount: _dec(ep.totalAmount),
  }));
  const socialInsuranceContracts = (raw.socialInsuranceContracts || []).map(
    (x) => ({
      contractId: _str(x.contractId),
      translationStatus: _str(x.translationStatus),
      boqStatus: _str(x.boqStatus),
      fileStatus: _str(x.fileStatus),
      fileNumber: _str(x.fileNumber),
      fileRate: _dec(x.fileRate),
      objectionStatus: _str(x.objectionStatus),
      objectionDate:
        !x.objectionDate ||
        x.objectionDate === "1970-01-01" ||
        x.objectionDate === "0001-01-01"
          ? null
          : x.objectionDate,
      openingDate:
        !x.openingDate ||
        x.openingDate === "1970-01-01" ||
        x.openingDate === "0001-01-01"
          ? null
          : x.openingDate,
      notes: _str(x.notes),
    }),
  );
  const socialInsurancePayments = (raw.socialInsurancePayments || []).map(
    (x) => ({
      invoiceId: _str(x.invoiceId),
      contractId: _str(x.contractId),
      amount: _dec(x.amount),
      paidAmount: _dec(x.paidAmount),
      status: _str(x.status),
      paymentDate: x.paymentDate || null,
      reference: _str(x.reference),
      notes: _str(x.notes),
    }),
  );
  const escalations = (raw.escalations || []).map((x) => ({
    invoiceDeductionId: _str(x.invoiceDeductionId),
    responseStatus: normalizeEscalationStatus(x.responseStatus),
    responseDate: x.responseDate || null,
    returnedAmount: _dec(x.returnedAmount),
  }));
  const deductionLibrary = (raw.deductionLibrary || [])
    .filter((item) => item && item.name)
    .map((d) => ({
      id: _str(d.id),
      name: _str(d.name),
    }));

  return {
    owners,
    projects,
    contracts,
    invoices,
    execPositions,
    socialInsuranceContracts,
    socialInsurancePayments,
    escalations,
    deductionLibrary,
  };
}

function buildBootstrapPayload() {
  const socialContracts = Object.values(
    state.socialInsurance?.contracts || {},
  ).map((x) => ({
    contractId: x.contractId || x.id,
    translationStatus: x.translationStatus,
    boqStatus: x.boqStatus,
    fileStatus: x.fileStatus,
    fileNumber: x.fileNumber,
    fileRate: parseFloat(x.fileRate) || 0,
    objectionStatus: x.objectionStatus,
    objectionDate:
      !x.objectionDate ||
      x.objectionDate === "1970-01-01" ||
      x.objectionDate === "0001-01-01"
        ? null
        : x.objectionDate,
    openingDate:
      !x.openingDate ||
      x.openingDate === "1970-01-01" ||
      x.openingDate === "0001-01-01"
        ? null
        : x.openingDate,
    notes: x.notes,
  }));

  const socialPayments = Object.values(
    state.socialInsurance?.payments || {},
  ).map((x) => ({
    invoiceId: x.invoiceId || x.id,
    contractId: x.contractId,
    amount: parseFloat(x.amount) || 0,
    paidAmount: parseFloat(x.paidAmount) || 0,
    status: x.status,
    paymentDate: x.paymentDate || null,
    reference: x.reference,
    notes: x.notes,
  }));

  const escalations = Object.entries(state.escalationsResponses || {}).map(
    ([invoiceDeductionId, x]) => ({
      invoiceDeductionId,
      responseStatus: normalizeEscalationStatus(x?.responseStatus),
      responseDate: x?.responseDate || null,
      returnedAmount: parseFloat(x?.returnedAmount) || 0,
    }),
  );

  const deductionLibrary = (state.deductionLibrary || []).filter(
    (item) => item && item.name,
  );

  const payload = {
    owners: state.owners,
    projects: state.projects,
    contracts: state.contracts,
    invoices: (Array.isArray(state.invoices) ? state.invoices : []).map(
      normalizeInvoiceForApi,
    ),
    execPositions: state.execPositions,
    socialInsuranceContracts: socialContracts,
    socialInsurancePayments: socialPayments,
    escalations,
    deductionLibrary,
  };

  // Central normalization: ensure every field matches the backend DTO types.
  // Excel may convert phone numbers, IDs etc. to JS numbers which causes
  // C# System.Text.Json to reject them (string? Phone cannot read a JSON number).
  return normalizeBootstrapPayload(payload);
}

async function syncStateFromBackend() {
  try {
    const remote = await erpApi.bootstrap();
    applyBootstrapToState(remote || {});
    apiOnline = true;
    // Keep sectorManagers fresh so project table lookups resolve correctly
    await loadSectorManagers();
  } catch (error) {
    console.error("Failed to sync state from backend:", error);
    apiOnline = false;
  }
}

async function pushStateToBackend() {
  if (!apiOnline || apiSyncInFlight) {
    if (apiSyncInFlight) apiSyncQueued = true;
    return;
  }

  apiSyncInFlight = true;
  try {
    await erpApi.upsertBootstrap(buildBootstrapPayload());
  } catch (error) {
    apiOnline = false;
    console.error("ERP API sync failed:", error);
  } finally {
    apiSyncInFlight = false;
    if (apiSyncQueued) {
      apiSyncQueued = false;
      queueBackendSync();
    }
  }
}

function queueBackendSync() {
  if (!apiOnline) return;
  apiSyncQueued = true;
  clearTimeout(apiSyncTimer);
  apiSyncTimer = setTimeout(() => {
    apiSyncQueued = false;
    pushStateToBackend();
  }, 250);
}

function saveLocalStorage() {
  // Kept as a compatibility name for existing UI handlers; persistence is API/DB only.
  queueBackendSync();
}
// Remembers which page the user was viewing so a browser refresh doesn't
// bounce them back to the dashboard. UI/navigation state only — no business
// data is stored here (data persistence remains API/DB only, as above).
const LAST_PAGE_STORAGE_KEY = "erpLastActivePage";
const PAGE_TITLES = {
  dashboardView: "لوحة المتابعة",
  ownersView: "إدارة الملاك",
  projectsView: "إدارة المشروعات",
  contractsView: "إدارة العقود",
  invoicesView: "إدارة المستخلصات",
  socialInsuranceView: "التأمينات الاجتماعية",
  execPositionView: "الموقف التنفيذي",
  costControlView: "مراقبة تكاليف العقود",
  escalationsView: "شاشة التعليات",
  reportsView: "شاشة التقارير",
  importExportView: "تصدير واستيراد البيانات",
  accountsView: "الحسابات والصلاحيات",
};

function activatePage(pageId, { persist = true } = {}) {
  if (!getSession()) {
    showLogin();
    return;
  }
  if (!canAccessPage(pageId)) {
    alert("ليس لديك صلاحية للوصول إلى هذه الصفحة");
    return;
  }

  const targetPage = document.getElementById(pageId);
  if (!targetPage) return;

  document
    .querySelectorAll(".sidebar-link")
    .forEach((l) => l.classList.remove("active"));
  document
    .querySelectorAll(".page-view")
    .forEach((v) => v.classList.remove("active"));

  const link = document.querySelector(`.sidebar-link[data-page="${pageId}"]`);
  if (link) link.classList.add("active");
  targetPage.classList.add("active");

  const titleEl = document.getElementById("pageTitleDisplay");
  if (titleEl) titleEl.innerText = PAGE_TITLES[pageId] || "";

  if (pageId === "accountsView" && typeof renderAccountsPage === "function") {
    renderAccountsPage();
  }
  if (
    pageId === "costControlView" &&
    typeof window.initCostControlPage === "function"
  ) {
    window.initCostControlPage();
  } else {
    // إعادة إظهار شريط الفلاتر عند مغادرة صفحة مراقبة التكلفة
    const filterBar = document.getElementById("global-filters-bar");
    if (filterBar) filterBar.style.display = "";
  }

  // Re-apply button visibility for the active page tables/actions
  if (typeof applyPermissionUI === "function") applyPermissionUI();

  if (persist) {
    try {
      localStorage.setItem(LAST_PAGE_STORAGE_KEY, pageId);
    } catch (error) {
      /* ignore storage errors */
    }
  }
}

function restoreLastActivePage() {
  let savedPage = null;
  try {
    savedPage = localStorage.getItem(LAST_PAGE_STORAGE_KEY);
  } catch (error) {
    /* ignore storage errors */
  }
  if (savedPage && document.getElementById(savedPage)) {
    activatePage(savedPage, { persist: false });
  }
}

function initCentralizedEventListeners() {
  document.querySelectorAll(".sidebar-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const pageId = link.getAttribute("data-page");
      activatePage(pageId);
      applyGlobalFilters();
    });
  });

  initGlobalMultiFilters();
  const fProjectName = document.getElementById("filterProjectName");

  if (fProjectName) {
    fProjectName.addEventListener("input", () => {
      state.filters.projectName = fProjectName.value;
      applyGlobalFilters();
    });
  }

  const btnRefreshDashboard = document.getElementById("btnRefreshDashboard");
  if (btnRefreshDashboard) {
    btnRefreshDashboard.addEventListener("click", () => {
      applyGlobalFilters();
    });
  }

  const btnResetFilters = document.getElementById("btnResetFilters");
  if (btnResetFilters) {
    btnResetFilters.addEventListener("click", () => {
      document.querySelectorAll(".filter-ctrl").forEach((c) => (c.value = ""));
      state.filters = {
        ownerIds: [],
        projectIds: [],
        projectName: "",
        contractIds: [],
        escStatus: "",
        accPeriod: "",
      };
      updateGlobalFilterDropdowns();
      applyGlobalFilters();
    });
  }

  const bindSearch = (inputId, tableId, callback) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    // Paginated tables: store search term and re-render
    const paginatedTables = [
      "tblOwners",
      "tblProjects",
      "tblContracts",
      "tblInvoices",
    ];
    input.addEventListener("input", function () {
      const query = this.value.toLowerCase().trim();
      if (paginatedTables.includes(tableId)) {
        _resetPagination(tableId);
        if (!_searchTerms) _searchTerms = {};
        _searchTerms[tableId] = query;
        if (tableId === "tblOwners") renderOwners(state);
        else if (tableId === "tblProjects") renderProjects(state);
        else if (tableId === "tblContracts") renderContracts(state);
        else if (tableId === "tblInvoices") {
          renderInvoices(state);
          SummaryEngine.update("invoices");
        }
      } else {
        // Non-paginated tables: DOM-based row filtering (escalations, reports, etc.)
        const rows = document.querySelectorAll(`#${tableId} tbody tr`);
        rows.forEach((row) => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(query) ? "" : "none";
        });
      }
      if (callback) callback();
    });
  };

  // Search terms storage for paginated tables
  window._searchTerms = {};
  var _searchTerms = window._searchTerms;

  bindSearch("searchOwners", "tblOwners");
  bindSearch("searchProjects", "tblProjects");
  bindSearch("searchContracts", "tblContracts");
  bindSearch("searchInvoices", "tblInvoices", () =>
    SummaryEngine.update("invoices"),
  );
  initInvoiceDateSortHeader();
  bindSearch("searchEscalations", "tblEscalations", filterEscalationsByStatus);

  bindSearch("searchRepExec", "tblRepExec", updateRepExecFooter);
  bindSearch("searchRepEsc", "tblRepEsc", () => {
    filterRepEscRows();
    updateRepEscFooter();
  });
  bindSearch("searchRepInv", "tblRepInv", () => {
    filterRepInvRows();
    updateRepInvFooter();
  });

  // Report page multi-select filters (Search + Multi-Select, same pattern as global filters)
  initRepMultiFilters();

  const btnAddOwner = document.getElementById("btnAddOwner");
  if (btnAddOwner)
    btnAddOwner.addEventListener("click", () => openOwnerModal());

  const btnDeleteAllOwners = document.getElementById("btnDeleteAllOwners");
  if (btnDeleteAllOwners)
    btnDeleteAllOwners.addEventListener("click", () => deleteAllOwners());

  const btnAddProject = document.getElementById("btnAddProject");
  if (btnAddProject)
    btnAddProject.addEventListener("click", () => openProjectModal());

  const btnAddContract = document.getElementById("btnAddContract");
  if (btnAddContract)
    btnAddContract.addEventListener("click", () => openContractModal());

  const btnAddInvoice = document.getElementById("btnAddInvoice");
  if (btnAddInvoice)
    btnAddInvoice.addEventListener("click", () => openInvoiceModal());

  const btnQuickInvoice = document.getElementById("btnQuickInvoice");
  if (btnQuickInvoice)
    btnQuickInvoice.addEventListener("click", () => openInvoiceModal());

  document.querySelectorAll(".modal-close, .modal-cancel").forEach((b) => {
    b.addEventListener("click", () => {
      // Skip deduction library modal — it has its own independent close handler
      if (b.closest("#modalDeductionLibrary")) return;
      document
        .querySelectorAll(".modal-overlay")
        .forEach((m) => m.classList.remove("active"));
    });
  });

  const btnSaveOwner = document.getElementById("btnSaveOwner");
  if (btnSaveOwner) btnSaveOwner.addEventListener("click", saveOwner);

  const btnSaveProject = document.getElementById("btnSaveProject");
  if (btnSaveProject) btnSaveProject.addEventListener("click", saveProject);

  const btnSaveContract = document.getElementById("btnSaveContract");
  if (btnSaveContract) btnSaveContract.addEventListener("click", saveContract);

  const btnSaveInvoice = document.getElementById("btnSaveInvoice");
  if (btnSaveInvoice) btnSaveInvoice.addEventListener("click", saveInvoice);

  const invOwner = document.getElementById("invOwnerId");
  const invProj = document.getElementById("invProjectId");
  const invCont = document.getElementById("invContractId");

  if (invOwner) {
    invOwner.addEventListener("change", () => {
      populateModalProjects(invOwner.value);
      populateModalContracts(invProj ? invProj.value : "");
      updateInvoiceDueDate();
      loadPreviousInvoiceValues();
    });
  }

  if (invProj) {
    invProj.addEventListener("change", () => {
      populateModalContracts(invProj.value);
      updateInvoiceDueDate();
      loadPreviousInvoiceValues();
    });
  }

  if (invCont) {
    invCont.addEventListener("change", () => {
      updateInvoiceDueDate();
      loadPreviousInvoiceValues();
    });
  }

  const invDate = document.getElementById("invDate");
  if (invDate) invDate.addEventListener("change", updateInvoiceDueDate);

  const btnAddInvItem = document.getElementById("btnAddInvItem");
  if (btnAddInvItem)
    btnAddInvItem.addEventListener("click", () => addInvItemRow());

  const btnAddInvDeduction = document.getElementById("btnAddInvDeduction");
  if (btnAddInvDeduction)
    btnAddInvDeduction.addEventListener("click", () => addInvDeductionRow());

  const btnOpenDeductionLibrary = document.getElementById(
    "btnOpenDeductionLibrary",
  );
  if (btnOpenDeductionLibrary)
    btnOpenDeductionLibrary.addEventListener("click", openDeductionLibrary);
  const btnCloseDeductionLibrary = document.getElementById(
    "btnCloseDeductionLibrary",
  );
  if (btnCloseDeductionLibrary)
    btnCloseDeductionLibrary.addEventListener("click", closeDeductionLibrary);
  const btnCancelDeductionLibrary = document.getElementById(
    "btnCancelDeductionLibrary",
  );
  if (btnCancelDeductionLibrary)
    btnCancelDeductionLibrary.addEventListener("click", closeDeductionLibrary);
  const btnSaveDeductionLibraryItem = document.getElementById(
    "btnSaveDeductionLibraryItem",
  );
  if (btnSaveDeductionLibraryItem)
    btnSaveDeductionLibraryItem.addEventListener(
      "click",
      addDeductionLibraryItem,
    );

  document
    .getElementById("btnCloseSocialInsurance")
    ?.addEventListener("click", closeSocialInsuranceModal);
  document
    .getElementById("btnCancelSocialInsurance")
    ?.addEventListener("click", closeSocialInsuranceModal);
  document
    .getElementById("btnSaveSocialInsurance")
    ?.addEventListener("click", saveSocialInsuranceRecord);
  [
    "siTranslationStatus",
    "siBoqStatus",
    "siFileStatus",
    "siObjectionStatus",
  ].forEach((id) =>
    document
      .getElementById(id)
      ?.addEventListener("change", updateSocialInsuranceChecklist),
  );
  document
    .getElementById("tblSocialInsuranceContracts")
    ?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-si-edit-contract]");
      if (btn)
        openSocialInsuranceModal(btn.getAttribute("data-si-edit-contract"));
    });
  document
    .getElementById("btnRefreshSocialInsurance")
    ?.addEventListener("click", () => {
      syncAllSocialInsuranceInvoices();
      renderSocialInsurance(filteredData);
    });
  document
    .getElementById("btnExportSocialInsurance")
    ?.addEventListener("click", exportSocialInsuranceReport);
  [
    "searchSocialInsurance",
    "siFilterFileStatus",
    "siFilterPaymentStatus",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener(
        id === "searchSocialInsurance" ? "input" : "change",
        () => {
          _resetPagination("siContracts");
          _resetPagination("siInvoices");
          renderSocialInsurance(filteredData);
        },
      );
  });
  document
    .getElementById("btnCloseSocialInsurancePayment")
    ?.addEventListener("click", closeSocialInsurancePaymentModal);
  document
    .getElementById("btnCancelSocialInsurancePayment")
    ?.addEventListener("click", closeSocialInsurancePaymentModal);
  document
    .getElementById("btnSaveSocialInsurancePayment")
    ?.addEventListener("click", saveSocialInsurancePayment);
  document
    .getElementById("tblSocialInsuranceInvoices")
    ?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-si-pay-invoice]");
      if (btn)
        openSocialInsurancePaymentModal(
          btn.getAttribute("data-si-pay-invoice"),
        );
    });
  document
    .getElementById("deductionLibraryName")
    ?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addDeductionLibraryItem();
      }
    });
  document
    .getElementById("deductionLibraryList")
    ?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-library-delete]");
      if (btn)
        deleteDeductionLibraryItem(btn.getAttribute("data-library-delete"));
    });
  document
    .getElementById("deductionLibrarySearch")
    ?.addEventListener("input", () => {
      renderDeductionLibrary();
    });
  document
    .getElementById("deductionCardsContainer")
    ?.addEventListener("change", (e) => {
      if (e.target.classList.contains("ded-desc")) {
        e.target.setAttribute("data-library-id", e.target.value || "");
        calcInvoiceTotals();
      }
      // Event delegation for multi-select checkbox changes
      if (e.target.type === "checkbox" && e.target.closest(".ms-wrapper")) {
        updateMultiSelectLabel(e.target);
      }
    });

  document.querySelectorAll("#tblCumulativeItems tbody").forEach((tbody) => {
    tbody.addEventListener("input", (e) => {
      if (
        e.target &&
        (e.target.classList.contains("inv-summary-calc") ||
          e.target.classList.contains("inv-prev-val") ||
          e.target.classList.contains("inv-curr-val") ||
          e.target.classList.contains("inv-cum-val"))
      ) {
        calcInvoiceTotals();
      }
    });
    tbody.addEventListener("change", (e) => {
      if (
        e.target &&
        (e.target.classList.contains("inv-summary-calc") ||
          e.target.classList.contains("inv-prev-val") ||
          e.target.classList.contains("inv-curr-val") ||
          e.target.classList.contains("inv-cum-val"))
      ) {
        calcInvoiceTotals();
      }
    });
  });
  // Robust listener: bind directly to each cumulative input for reliable recalculation
  document.querySelectorAll(".inv-cum-val").forEach((inp) => {
    inp.addEventListener("input", () => calcInvoiceTotals());
    inp.addEventListener("change", () => calcInvoiceTotals());
  });
  // Targeted fix: ensure VAT cumulative input always triggers recalculation
  const vatCum = document.getElementById("invVat");
  if (vatCum) {
    vatCum.addEventListener("input", () => calcInvoiceTotals());
    vatCum.addEventListener("change", () => calcInvoiceTotals());
  }

  document.addEventListener("click", (e) => {
    // Event delegation for multi-select (ms-wrapper) controls
    const msBtn = e.target.closest(".ms-btn");
    if (msBtn && msBtn.closest(".ms-wrapper")) {
      const menu = msBtn.nextElementSibling;
      if (menu) {
        document.querySelectorAll(".ms-menu.open").forEach((m) => {
          if (m !== menu) m.classList.remove("open");
        });
        menu.classList.toggle("open");
      }
      return;
    }
    const msActionBtn = e.target.closest(".ms-action-btn");
    if (msActionBtn) {
      const menu = msActionBtn.closest(".ms-menu");
      if (menu) {
        const selectAll = msActionBtn.textContent.includes("تحديد الكل");
        menu.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
          chk.checked = selectAll;
        });
        const firstChk = menu.querySelector('input[type="checkbox"]');
        if (firstChk) {
          updateMultiSelectLabel(firstChk);
        }
      }
      return;
    }
    // Close open menus when clicking outside
    if (!e.target.closest(".ms-wrapper")) {
      document
        .querySelectorAll(".ms-menu.open")
        .forEach((m) => m.classList.remove("open"));
    }
  });

  const execProjectSelect = document.getElementById("execProjectSelect");
  if (execProjectSelect) {
    execProjectSelect.addEventListener("change", () => {
      // تغيير المشروع → أعد بناء العقود وافتراضيًا «كل عقود المشروع»
      fillExecContractOptions("");
      const cs = document.getElementById("execContractSelect");
      if (cs && execProjectSelect.value) cs.value = "";
      loadExecPositionForSelectedContract();
    });
  }

  const execContractSelect = document.getElementById("execContractSelect");
  if (execContractSelect) {
    execContractSelect.addEventListener("change", () => {
      ["workVolume", "variationOrders", "materials", "claims", "vat"].forEach(
        (k) => {
          const cum = document.getElementById("exec_" + k + "_cum");
          if (cum) cum.readOnly = false;
        },
      );
      loadExecPositionForSelectedContract();
    });
  }

  document.querySelectorAll(".exec-cum-input").forEach((input) => {
    input.addEventListener("input", () => {
      recalcExecPositionInputs();
    });
  });

  const btnSaveExecPosition = document.getElementById("btnSaveExecPosition");
  if (btnSaveExecPosition) {
    btnSaveExecPosition.addEventListener("click", saveExecPosition);
  }

  const btnDeleteLastExecVersion = document.getElementById(
    "btnDeleteLastExecVersion",
  );
  if (btnDeleteLastExecVersion) {
    btnDeleteLastExecVersion.addEventListener("click", deleteLastExecVersion);
  }

  document.getElementById("tblInvoices")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (action === "editInvoice") editInvoice(id);
    if (action === "deleteInvoice") deleteInvoice(id);
    if (action === "printInvoice") printInvoice(id);
  });

  document
    .getElementById("tblEscalations")
    ?.addEventListener("change", async (e) => {
      if (e.target.classList.contains("esc-status-ctrl")) {
        const key = e.target.getAttribute("data-key");
        if (key) {
          if (!state.escalationsResponses[key])
            state.escalationsResponses[key] = {};
          const newStatus = normalizeEscalationStatus(e.target.value);
          state.escalationsResponses[key].responseStatus = newStatus;

          const tr = e.target.closest("tr");
          const dateInput = tr ? tr.querySelector(".esc-date-ctrl") : null;
          const retInput = tr ? tr.querySelector(".esc-ret-ctrl") : null;
          const showRetAmt =
            newStatus === ESC_STATUS_DONE || newStatus === ESC_STATUS_PARTIAL;

          if (newStatus === ESC_STATUS_PENDING) {
            state.escalationsResponses[key].responseDate = "";
            state.escalationsResponses[key].returnedAmount = 0;
            if (dateInput) {
              dateInput.value = "";
              dateInput.disabled = true;
            }
          } else if (newStatus === ESC_STATUS_DONE) {
            // Closing an item MUST record a response date so the day
            // counter can freeze correctly — default to today if the
            // user hasn't picked a specific date yet.
            if (dateInput) {
              dateInput.disabled = false;
              if (!dateInput.value) dateInput.value = getTodayLocal();
              state.escalationsResponses[key].responseDate = dateInput.value;
            } else if (!state.escalationsResponses[key].responseDate) {
              state.escalationsResponses[key].responseDate = getTodayLocal();
            }
          } else {
            // Partial response: a date may be recorded for reference,
            // but it never freezes the day counter (still open).
            if (dateInput) {
              dateInput.disabled = false;
              state.escalationsResponses[key].responseDate = dateInput.value;
            }
          }

          // For a fully closed item, auto-set returnedAmount to the full amount
          const amt = parseFloat(tr?.getAttribute("data-amt")) || 0;
          if (newStatus === ESC_STATUS_DONE) {
            state.escalationsResponses[key].returnedAmount = amt;
          } else if (newStatus === ESC_STATUS_PARTIAL) {
            if (
              !state.escalationsResponses[key].returnedAmount ||
              state.escalationsResponses[key].returnedAmount <= 0
            ) {
              state.escalationsResponses[key].returnedAmount = amt * 0.5;
            }
          } else {
            state.escalationsResponses[key].returnedAmount = 0;
          }

          try {
            await erpApi.escalations.updatePayment(key, {
              invoiceDeductionId: key,
              responseStatus: newStatus,
              responseDate:
                toDateOnly(state.escalationsResponses[key].responseDate) ||
                null,
              returnedAmount:
                parseFloat(state.escalationsResponses[key].returnedAmount) || 0,
            });
            await syncStateFromBackend();
          } catch (err) {
            console.error("Escalation update failed:", err);
          }

          applyGlobalFilters();
        }
      } else if (e.target.classList.contains("esc-date-ctrl")) {
        const key = e.target.getAttribute("data-key");
        if (key) {
          if (!state.escalationsResponses[key])
            state.escalationsResponses[key] = {};
          state.escalationsResponses[key].responseDate = e.target.value;

          try {
            await erpApi.escalations.updatePayment(key, {
              invoiceDeductionId: key,
              responseStatus: normalizeEscalationStatus(
                state.escalationsResponses[key].responseStatus,
              ),
              responseDate: toDateOnly(e.target.value) || null,
              returnedAmount:
                parseFloat(state.escalationsResponses[key].returnedAmount) || 0,
            });
            await syncStateFromBackend();
          } catch (err) {
            console.error("Escalation date update failed:", err);
          }

          applyGlobalFilters();
        }
      } else if (e.target.classList.contains("esc-ret-ctrl")) {
        const key = e.target.getAttribute("data-key");
        if (key) {
          if (!state.escalationsResponses[key])
            state.escalationsResponses[key] = {};
          const newRetAmt = parseFloat(e.target.value) || 0;
          state.escalationsResponses[key].returnedAmount = newRetAmt;

          try {
            await erpApi.escalations.updatePayment(key, {
              invoiceDeductionId: key,
              responseStatus: normalizeEscalationStatus(
                state.escalationsResponses[key].responseStatus,
              ),
              responseDate:
                toDateOnly(state.escalationsResponses[key].responseDate) ||
                null,
              returnedAmount: newRetAmt,
            });
            await syncStateFromBackend();
          } catch (err) {
            console.error("Escalation returned amount update failed:", err);
          }

          SummaryEngine.update("escalations");
        }
      }
    });

  document.querySelectorAll(".tab-item").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const navTabs = tab.closest(".nav-tabs");
      if (!navTabs) return;

      navTabs
        .querySelectorAll(".tab-item")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const targetId = tab.getAttribute("data-tab");
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        const container = targetContent.parentElement;
        if (container) {
          Array.from(container.children).forEach((child) => {
            if (child.classList.contains("tab-content")) {
              child.classList.remove("active");
            }
          });
        }
        targetContent.classList.add("active");
      }
    });
  });

  initImportExportModule();
}

function updateGlobalFilterDropdowns() {
  const f = state.filters;
  const ownerById = new Map(state.owners.map((o) => [o.id, o]));
  const projectById = new Map(state.projects.map((p) => [p.id, p]));

  const ownerItems = state.owners.map((o) => ({ id: o.id, label: o.name || o.id }));

  // projects limited by the selected owners
  let availProjects = state.projects;
  if (f.ownerIds.length) {
    availProjects = availProjects.filter((p) => f.ownerIds.includes(p.ownerId));
  }
  f.projectIds = f.projectIds.filter((id) => availProjects.some((p) => p.id === id));
  const projectItems = availProjects.map((p) => ({
    id: p.id,
    label: p.name || p.id,
    hint: (ownerById.get(p.ownerId) || {}).name || "",
  }));

  // contracts limited by the selected projects (or owners)
  let availContracts = state.contracts;
  if (f.projectIds.length) {
    availContracts = availContracts.filter((c) => f.projectIds.includes(c.projectId));
  } else if (f.ownerIds.length) {
    const pIds = new Set(availProjects.map((p) => p.id));
    availContracts = availContracts.filter((c) => pIds.has(c.projectId));
  }
  f.contractIds = f.contractIds.filter((id) => availContracts.some((c) => c.id === id));
  const contractItems = availContracts.map((c) => ({
    id: c.id,
    label: c.name || c.id,
    hint: (projectById.get(c.projectId) || {}).name || "",
  }));

  if (globalFilterUI.owner) globalFilterUI.owner.setOptions(ownerItems, f.ownerIds);
  if (globalFilterUI.project) globalFilterUI.project.setOptions(projectItems, f.projectIds);
  if (globalFilterUI.contract) globalFilterUI.contract.setOptions(contractItems, f.contractIds);
}

function populateModalProjects(ownerId) {
  const invProj = document.getElementById("invProjectId");
  if (!invProj) return;
  const filtered = ownerId
    ? state.projects.filter((p) => p.ownerId === ownerId)
    : state.projects;
  invProj.innerHTML =
    '<option value="">اختر المشروع...</option>' +
    filtered.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
}

function populateModalContracts(projectId) {
  const invCont = document.getElementById("invContractId");
  if (!invCont) return;
  const filtered = projectId
    ? state.contracts.filter((c) => c.projectId === projectId)
    : state.contracts;
  invCont.innerHTML =
    '<option value="">اختر العقد...</option>' +
    filtered.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

function applyGlobalFilters() {
  // Reset pagination when global filters change
  ["owners", "projects", "contracts", "invoices"].forEach((t) =>
    _resetPagination(t),
  );

  const f = state.filters;
  // empty selection = no restriction ("all")
  const inSel = (ids, id) => !ids.length || ids.includes(id);

  const projectSearch = String(f.projectName || "")
    .trim()
    .toLocaleLowerCase();
  const matchesProjectName = (project) =>
    !projectSearch ||
    String(project.name || "")
      .toLocaleLowerCase()
      .includes(projectSearch);
  const matchingProjectIds = new Set(
    state.projects.filter(matchesProjectName).map((project) => project.id),
  );

  const invoiceMatches = (inv) => {
    const contract = state.contracts.find((c) => c.id === inv.contractId) || {};
    const project =
      state.projects.find((p) => p.id === contract.projectId) || {};
    const owner = state.owners.find((o) => o.id === project.ownerId) || {};

    if (!inSel(f.ownerIds, owner.id)) return false;
    if (projectSearch && !matchingProjectIds.has(project.id)) return false;
    if (!inSel(f.projectIds, project.id)) return false;
    if (!inSel(f.contractIds, contract.id)) return false;
    return true;
  };

  const invList = state.invoices.filter(invoiceMatches);

  const contractList = state.contracts.filter((c) => {
    const project = state.projects.find((p) => p.id === c.projectId) || {};
    if (projectSearch && !matchingProjectIds.has(project.id)) return false;
    if (!inSel(f.contractIds, c.id)) return false;
    if (!inSel(f.projectIds, c.projectId)) return false;
    if (!inSel(f.ownerIds, project.ownerId)) return false;
    return true;
  });

  const projectList = state.projects.filter((p) => {
    if (!matchesProjectName(p)) return false;
    if (!inSel(f.projectIds, p.id)) return false;
    if (!inSel(f.ownerIds, p.ownerId)) return false;
    return true;
  });

  const ownerList = state.owners.filter((o) => {
    if (!inSel(f.ownerIds, o.id)) return false;
    if (
      projectSearch &&
      !state.projects.some(
        (project) =>
          project.ownerId === o.id && matchingProjectIds.has(project.id),
      )
    )
      return false;
    return true;
  });

  filteredData = {
    owners: ownerList,
    projects: projectList,
    contracts: contractList,
    invoices: invList,
  };

  // التعليات: تظهر كل الاستقطاعات القابلة للمتابعة بغض النظر عن حالة المستخلص (مسودة/معتمد/...)
  const invListForEscalations = state.invoices.filter(invoiceMatches);
  const escData = { ...filteredData, invoices: invListForEscalations };

  renderDashboard(filteredData);
  renderOwners(filteredData);
  renderProjects(filteredData);
  renderContracts(filteredData);
  renderInvoices(filteredData);
  renderExecPosition(filteredData);
  renderEscalations(escData);
  renderReports(filteredData);
  renderSocialInsurance(filteredData);
  if (typeof applyPermissionUI === "function") applyPermissionUI();
}

function checkEmptyTable(tbody, colSpan) {
  if (!tbody || tbody.children.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding: 2rem; color: var(--gray);">لا توجد بيانات مطابقة للفلاتر الحالية</td></tr>`;
  }
}

/* ================================================================
 * REUSABLE PAGINATION SYSTEM
 * ================================================================ */
const _paginationState = {};

function _getPaginationState(tableId) {
  if (!_paginationState[tableId]) {
    _paginationState[tableId] = { page: 1, pageSize: 25 };
  }
  return _paginationState[tableId];
}

function _setPaginationPage(tableId, page) {
  _paginationState[tableId].page = page;
}

function _setPaginationPageSize(tableId, size) {
  _paginationState[tableId].pageSize = size;
  _paginationState[tableId].page = 1; // reset to first page
}

function _resetPagination(tableId) {
  _paginationState[tableId] = { page: 1, pageSize: 25 };
}

/** Slice data array for the current page. */
function paginate(data, tableId) {
  const ps = _getPaginationState(tableId);
  const start = (ps.page - 1) * ps.pageSize;
  return data.slice(start, start + ps.pageSize);
}

/** Build pagination bar HTML and inject it into containerId.
 *  renderFn: callback that re-renders the table when page changes.
 *  Returns the HTML string for the pagination bar.
 */
function renderPaginationBar(containerId, totalItems, tableId, renderFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const ps = _getPaginationState(tableId);
  const totalPages = Math.max(1, Math.ceil(totalItems / ps.pageSize));

  // Clamp current page
  if (ps.page > totalPages) ps.page = totalPages;
  if (ps.page < 1) ps.page = 1;

  const from = totalItems === 0 ? 0 : (ps.page - 1) * ps.pageSize + 1;
  const to = Math.min(ps.page * ps.pageSize, totalItems);

  // Build page buttons with ellipsis
  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (ps.page > 3) pages.push("...");
    const start = Math.max(2, ps.page - 1);
    const end = Math.min(totalPages - 1, ps.page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (ps.page < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  let html = `<div class="pagination-bar">`;
  html += `<span class="pagination-info">عرض ${from}–${to} من ${totalItems} سجل</span>`;
  html += `<div class="pagination-controls">`;
  html += `<button class="pagination-btn" ${ps.page <= 1 ? "disabled" : ""} data-paginate="${tableId}" data-page="prev">السابق</button>`;
  pages.forEach((p) => {
    if (p === "...") {
      html += `<span class="pagination-btn pagination-ellipsis">…</span>`;
    } else {
      html += `<button class="pagination-btn ${p === ps.page ? "active" : ""}" data-paginate="${tableId}" data-page="${p}">${p}</button>`;
    }
  });
  html += `<button class="pagination-btn" ${ps.page >= totalPages ? "disabled" : ""} data-paginate="${tableId}" data-page="next">التالي</button>`;
  html += `</div>`;
  html += `<div class="pagination-size"><label>العرض:</label><select data-paginate-size="${tableId}">`;
  [10, 25, 50, 100].forEach((s) => {
    html += `<option value="${s}" ${s === ps.pageSize ? "selected" : ""}>${s}</option>`;
  });
  html += `</select></div>`;
  html += `</div>`;

  container.innerHTML = html;

  // Event delegation for page buttons
  container.querySelectorAll("[data-paginate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (page === "prev") _setPaginationPage(tableId, ps.page - 1);
      else if (page === "next") _setPaginationPage(tableId, ps.page + 1);
      else _setPaginationPage(tableId, parseInt(page));
      renderFn();
    });
  });

  // Event for page size selector
  const sizeSelect = container.querySelector(
    `[data-paginate-size="${tableId}"]`,
  );
  if (sizeSelect) {
    sizeSelect.addEventListener("change", () => {
      _setPaginationPageSize(tableId, parseInt(sizeSelect.value));
      renderFn();
    });
  }
}

/** Paginated table render helper.
 *  Wraps an existing render function to add pagination.
 *  @param {string} tableId - unique table identifier
 *  @param {Array} fullData - the full filtered data array
 *  @param {string} containerId - ID of div where pagination bar goes
 *  @param {string} tbodySelector - CSS selector for tbody
 *  @param {number} colSpan - number of columns for empty state
 *  @param {function} renderFn(fullDataSlice) - renders table rows from a slice
 */
function renderPaginatedTable(
  tableId,
  fullData,
  containerId,
  tbodySelector,
  colSpan,
  renderFn,
) {
  const ps = _getPaginationState(tableId);
  const totalPages = Math.max(1, Math.ceil(fullData.length / ps.pageSize));
  if (ps.page > totalPages) ps.page = totalPages;
  if (ps.page < 1) ps.page = 1;

  const slice = paginate(fullData, tableId);
  const tbody = document.querySelector(tbodySelector);
  if (!tbody) return;
  tbody.innerHTML = "";

  if (fullData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}"><div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">لا توجد بيانات لعرضها</div><div class="empty-state-sub">لم يتم العثور على سجلات مطابقة</div></div></td></tr>`;
  } else {
    renderFn(slice);
  }

  renderPaginationBar(containerId, fullData.length, tableId, () =>
    renderPaginatedTable(
      tableId,
      fullData,
      containerId,
      tbodySelector,
      colSpan,
      renderFn,
    ),
  );
}

/** Reset pagination state and re-render. Call after filter/search changes. */
function resetPaginationAndRender(tableId) {
  _resetPagination(tableId);
}

/* ================================================================
 * DELETE ALL OWNERS
 * ================================================================ */
async function deleteAllOwners() {
  if (!assertCan("owners", "delete", "مسح الكل")) return;
  const btn = document.getElementById("btnDeleteAllOwners");
  if (!btn) return;

  // Count owners and related records
  const ownerCount = (state.owners || []).length;
  if (ownerCount === 0) {
    alert("لا يوجد ملاك للحذف.");
    return;
  }

  // Build related records info
  const projectCount = (state.projects || []).length;
  const contractCount = (state.contracts || []).length;
  const invoiceCount = (state.invoices || []).length;

  let relatedText = "";
  if (projectCount > 0 || contractCount > 0 || invoiceCount > 0) {
    relatedText = `<div class="related-info"><strong>⚠️ البيانات المرتبطة:</strong>`;
    if (projectCount > 0) relatedText += `\n• ${projectCount} مشروع مرتبطة`;
    if (contractCount > 0) relatedText += `\n• ${contractCount} عقد مرتبط`;
    if (invoiceCount > 0) relatedText += `\n• ${invoiceCount} مستخلص مرتبط`;
    relatedText += `<br><br>سيتم حذف جميع البيانات المرتبطة حسب العلاقات في النظام.</div>`;
  }

  // Show confirmation modal
  const overlay = document.createElement("div");
  overlay.className = "confirm-delete-overlay";
  overlay.innerHTML = `
        <div class="confirm-delete-card">
            <div class="confirm-delete-header">
                <div class="warning-icon">⚠️</div>
                <h3>تأكيد حذف جميع الملاك</h3>
            </div>
            <div class="confirm-delete-body">
                <p>أنت على وشك حذف <strong>${ownerCount} مالك</strong> وجميع البيانات المرتبطة بهم.</p>
                ${relatedText}
                <p style="margin-top:1rem;font-weight:600;color:var(--danger);">هذا الإجراء لا يمكن التراجع عنه.</p>
                <div class="confirm-input-group">
                    <label>اكتب "حذف" للتأكيد:</label>
                    <input type="text" id="confirmDeleteAllInput" placeholder="حذف" autocomplete="off">
                </div>
            </div>
            <div class="confirm-delete-footer">
                <button class="btn btn-secondary" id="btnCancelDeleteAll">إلغاء</button>
                <button class="btn btn-danger btn-disabled" id="btnConfirmDeleteAll">🗑️ حذف الكل</button>
            </div>
        </div>
    `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#confirmDeleteAllInput");
  const confirmBtn = overlay.querySelector("#btnConfirmDeleteAll");
  const cancelBtn = overlay.querySelector("#btnCancelDeleteAll");

  input.focus();

  input.addEventListener("input", () => {
    if (input.value.trim() === "حذف") {
      confirmBtn.classList.remove("btn-disabled");
    } else {
      confirmBtn.classList.add("btn-disabled");
    }
  });

  cancelBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  confirmBtn.addEventListener("click", async () => {
    if (input.value.trim() !== "حذف") return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = "جاري الحذف...";
    input.disabled = true;
    cancelBtn.disabled = true;

    try {
      // Use the existing individual delete API in a loop with transaction
      // (the backend DELETE /api/owners/{id} already handles cascading deletes)
      const ownerIds = state.owners.map((o) => o.id);
      let deletedCount = 0;
      for (const id of ownerIds) {
        try {
          await erpApi.owners.remove(id);
          deletedCount++;
        } catch (err) {
          console.error(`Failed to delete owner ${id}:`, err);
        }
      }

      overlay.remove();
      alert(`تم حذف ${deletedCount} من ${ownerIds.length} مالك بنجاح.`);

      // Reload from backend
      try {
        const remote = await erpApi.bootstrap();
        applyBootstrapToState(remote || {});
        applyGlobalFilters();
      } catch (e) {
        console.error("Failed to reload after delete all:", e);
      }
    } catch (err) {
      overlay.remove();
      alert("تعذر إتمام عملية الحذف. لم يتم حذف أي بيانات.");
      console.error("Delete all owners error:", err);
    }
  });
}

function populateDropdowns() {
  // global owner / project / contract multi-selects
  updateGlobalFilterDropdowns();

  document.getElementById("projectOwnerId").innerHTML = state.owners
    .map((o) => `<option value="${o.id}">${o.name}</option>`)
    .join("");
  document.getElementById("contractProjectId").innerHTML = state.projects
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
  document.getElementById("invOwnerId").innerHTML =
    '<option value="">اختر المالك...</option>' +
    state.owners
      .map((o) => `<option value="${o.id}">${o.name}</option>`)
      .join("");
}

function updateInvoiceDueDate() {
  const contractId = document.getElementById("invContractId").value;
  const invDateVal = document.getElementById("invDate").value;

  if (!contractId || !invDateVal) {
    setInputDate("invDueDate", "");
    return;
  }

  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return;

  const terms = parseInt(contract.paymentTerms) || 0;
  const d = new Date(invDateVal);
  d.setDate(d.getDate() + terms);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  setInputDate("invDueDate", `${year}-${month}-${day}`);
}

function getInvoiceCumulativeComponents(inv) {
  if (!inv)
    return {
      workVolume: 0,
      variationOrders: 0,
      materials: 0,
      claims: 0,
      vat: 0,
    };
  const source = inv.cumulativeValues || {};
  const read = (key) => {
    const value =
      source[key] !== undefined && source[key] !== null
        ? source[key]
        : inv[key];
    return parseFloat(value) || 0;
  };
  return {
    workVolume: read("workVolume"),
    variationOrders: read("variationOrders"),
    materials: read("materials"),
    claims: read("claims"),
    vat: read("vat"),
  };
}

function getOrderedContractInvoices(contractId, invoices = state.invoices) {
  return (invoices || [])
    .map((invoice, index) => ({ invoice, index }))
    .filter((x) => x.invoice && x.invoice.contractId === contractId)
    .sort((a, b) => {
      const dateDiff = String(a.invoice.date || "").localeCompare(
        String(b.invoice.date || ""),
      );
      if (dateDiff !== 0) return dateDiff;

      const createdA = String(a.invoice.createdAt || "");
      const createdB = String(b.invoice.createdAt || "");
      const createdDiff = createdA.localeCompare(createdB);
      if (createdDiff !== 0) return createdDiff;

      const idDiff = String(a.invoice.id || "").localeCompare(
        String(b.invoice.id || ""),
      );
      if (idDiff !== 0) return idDiff;

      return a.index - b.index;
    });
}

function getLatestInvoiceForContract(contractId, invoices = state.invoices) {
  const ordered = getOrderedContractInvoices(contractId, invoices);
  return ordered.length ? ordered[ordered.length - 1].invoice : null;
}

function getInvoiceCurrentComponents(inv, invoices = state.invoices) {
  const zero = {
    workVolume: 0,
    variationOrders: 0,
    materials: 0,
    claims: 0,
    vat: 0,
  };
  if (!inv) return zero;

  const ordered = getOrderedContractInvoices(inv.contractId, invoices);
  const index = ordered.findIndex((x) => x.invoice.id === inv.id);
  if (index < 0) {
    // Legacy/fallback record: use the saved Current values if available.
    const saved = inv.currentValues || inv.currentComponents || {};
    return {
      workVolume: parseFloat(saved.workVolume) || 0,
      variationOrders: parseFloat(saved.variationOrders) || 0,
      materials: parseFloat(saved.materials) || 0,
      claims: parseFloat(saved.claims) || 0,
      vat: parseFloat(saved.vat) || 0,
    };
  }

  const cumulative = getInvoiceCumulativeComponents(inv);
  const previous =
    index > 0
      ? getInvoiceCumulativeComponents(ordered[index - 1].invoice)
      : zero;

  return {
    workVolume: cumulative.workVolume - previous.workVolume,
    variationOrders: cumulative.variationOrders - previous.variationOrders,
    materials: cumulative.materials - previous.materials,
    claims: cumulative.claims - previous.claims,
    vat: cumulative.vat - previous.vat,
  };
}

function getContractInvoiceTotals(contractId, invoices = state.invoices) {
  const ordered = getOrderedContractInvoices(contractId, invoices);
  if (!ordered.length) {
    return {
      workVolume: 0,
      variationOrders: 0,
      materials: 0,
      claims: 0,
      vat: 0,
    };
  }

  // The contract total is the latest cumulative invoice. This is mathematically
  // identical to summing the correctly derived Current values of all invoices.
  return getInvoiceCumulativeComponents(ordered[ordered.length - 1].invoice);
}

function getInvoiceGross(inv) {
  if (!inv) return 0;

  // إجمالي المستخلص في التقارير = إجمالي القيمة الحالية للمستخلص فقط.
  // لا نستخدم القيم التراكمية المحفوظة في workVolume / variationOrders / ...
  const current = getInvoiceCurrentComponents(inv, state.invoices);

  const wv = parseFloat(current.workVolume) || 0;
  const vo = parseFloat(current.variationOrders) || 0;
  const mat = parseFloat(current.materials) || 0;
  const cl = parseFloat(current.claims) || 0;
  const vat = parseFloat(current.vat) || 0;

  let itemsTotal = 0;
  if (Array.isArray(inv.items)) {
    itemsTotal = inv.items.reduce(
      (s, x) => s + (parseFloat(x.currentTotal ?? x.total) || 0),
      0,
    );
  }

  return wv + vo + mat + cl + vat + itemsTotal;
}

function getInvoiceNet(inv) {
  const gross = getInvoiceGross(inv);
  const totalDeductions = Array.isArray(inv?.deductions)
    ? inv.deductions.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0)
    : 0;

  // الصافي النقدي = إجمالي مكونات المستخلص الحالية - إجمالي الاستقطاعات
  return Math.max(0, gross - totalDeductions);
}

function renderDashboard(data) {
  const source = data ||
    filteredData || { owners: [], projects: [], contracts: [], invoices: [] };
  const contracts = Array.isArray(source.contracts) ? source.contracts : [];
  const invoices = Array.isArray(source.invoices) ? source.invoices : [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const contractMap = new Map(state.contracts.map((c) => [c.id, c]));
  const projectMap = new Map(state.projects.map((p) => [p.id, p]));
  const ownerMap = new Map(state.owners.map((o) => [o.id, o]));

  const latestExecutionByContract = new Map();
  contracts.forEach((contract) => {
    const positions = state.execPositions
      .filter((e) => e.contractId === contract.id)
      .slice()
      .sort(
        (a, b) =>
          new Date(a.date || 0) - new Date(b.date || 0) ||
          (parseFloat(a.versionNumber) || 0) -
            (parseFloat(b.versionNumber) || 0),
      );
    if (positions.length)
      latestExecutionByContract.set(
        contract.id,
        positions[positions.length - 1],
      );
  });

  const executionTotal = (pos) =>
    pos
      ? ["workVolume", "variationOrders", "materials", "claims", "vat"].reduce(
          (sum, key) => sum + (parseFloat(pos[key]) || 0),
          0,
        )
      : 0;

  const totalContractValue = contracts.reduce(
    (sum, c) => sum + (parseFloat(c.amount) || 0),
    0,
  );
  const totalExecValue = contracts.reduce(
    (sum, c) => sum + executionTotal(latestExecutionByContract.get(c.id)),
    0,
  );
  const totalModifiedContractValue = contracts.reduce(
    (sum, c) => sum + getContractModifiedTotal(c),
    0,
  );

  let totalGross = 0;
  let totalNet = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;
  let totalPending = 0;
  let totalOverdue = 0;
  let totalPaymentDays = 0;
  let paidCount = 0;

  invoices.forEach((inv) => {
    const gross = getInvoiceGross(inv);
    const net = getInvoiceNet(inv);
    const paid = Math.max(0, parseFloat(inv.paidAmount) || 0);
    const outstanding = Math.max(0, net - paid);
    totalGross += gross;
    totalNet += net;
    totalPaid += paid;
    totalOutstanding += outstanding;

    if (outstanding > 0) {
      const due = inv.dueDate ? new Date(inv.dueDate) : null;
      if (due && !isNaN(due) && due < today) totalOverdue += outstanding;
      else totalPending += outstanding;
    }

    if (inv.paymentDate && inv.date) {
      const d1 = new Date(inv.date);
      const d2 = new Date(inv.paymentDate);
      const diff = Math.floor((d2 - d1) / 86400000);
      if (!isNaN(diff) && diff >= 0) {
        totalPaymentDays += diff;
        paidCount++;
      }
    }
  });

  let totalEscalations = 0;
  let unreturnedEscalations = 0;
  invoices.forEach((inv) => {
    if (!Array.isArray(inv.deductions)) return;
    inv.deductions.forEach((d, idx) => {
      if (!d.isRefundable) return;
      const amount = parseFloat(d.amount) || parseFloat(d.val) || 0;

      // For social insurance deductions, use payment status from social insurance module
      if (isSocialInsuranceDeduction(d)) {
        const siView = getSocialInsuranceEscalationView(inv);
        totalEscalations += amount;
        if (siView.status === "غير مسدد") unreturnedEscalations += amount;
        else if (siView.status === "مسدد جزئياً") {
          unreturnedEscalations += Math.max(0, siView.outstanding);
        }
        return;
      }

      const response =
        state.escalationsResponses[d.id || `${inv.id}_${idx}`] || {};
      const status = normalizeEscalationStatus(response.responseStatus);
      totalEscalations += amount;
      if (status === ESC_STATUS_PENDING) unreturnedEscalations += amount;
      else if (status === ESC_STATUS_PARTIAL) {
        const returned =
          response.returnedAmount !== undefined
            ? parseFloat(response.returnedAmount) || 0
            : amount * 0.5;
        unreturnedEscalations += Math.max(0, amount - returned);
      }
    });
  });

  let socialInsuranceOutstanding = 0;
  invoices.forEach((inv) => {
    const amount = getSocialInsuranceDeductionAmount(inv);
    if (!amount) return;
    const payment = state.socialInsurance?.payments?.[inv.id] || {};
    const paid = Math.min(
      amount,
      Math.max(0, parseFloat(payment.paidAmount) || 0),
    );
    socialInsuranceOutstanding += Math.max(0, amount - paid);
  });

  const execRate =
    totalContractValue > 0 ? (totalExecValue / totalContractValue) * 100 : 0;
  const collectionRate = totalNet > 0 ? (totalPaid / totalNet) * 100 : 0;
  const remainingContracts = Math.max(0, totalContractValue - totalExecValue);
  const avgPaymentDays = paidCount
    ? Math.round(totalPaymentDays / paidCount)
    : 0;
  const uniqueProjects = new Set(
    contracts.map((c) => c.projectId).filter(Boolean),
  );

  const setKpi = (id, value, currency = true, percent = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (percent)
      el.innerText = `${fmtNum(Math.max(0, Math.min(100, value)), 1)}%`;
    else if (currency) {
      el.innerText = fmtNumShort(value);
      el.setAttribute("data-full", fmtNum(value));
    } else el.innerText = fmtNum(value, 0);
  };

  setKpi("kpiTotalContractValue", totalContractValue);
  setKpi("kpiTotalModifiedContractValue", totalModifiedContractValue);
  setKpi("kpiRemainingExecution", totalExecValue - totalModifiedContractValue);
  setKpi("kpiTotalExecValue", totalExecValue);
  setKpi("kpiGross", totalGross);
  setKpi("kpiNet", totalNet);
  setKpi("kpiPaid", totalPaid);
  setKpi("kpiPending", totalOutstanding);
  setKpi("kpiOverdue", totalOverdue);
  setKpi("kpiRemainingContracts", remainingContracts);
  setKpi("kpiExecRate", execRate, false, true);
  setKpi("kpiCollectionRate", collectionRate, false, true);
  setKpi("kpiContractsCount", contracts.length, false, false);
  setKpi("kpiProjectsCount", uniqueProjects.size, false, false);
  setKpi("kpiAvgPaymentDays", avgPaymentDays, false, false);
  setKpi("kpiTotalEscalations", totalEscalations);
  setKpi("kpiUnreturnedEscalations", unreturnedEscalations);
  setKpi("kpiSocialInsuranceOutstanding", socialInsuranceOutstanding);

  const summary = document.getElementById("mcManagementSummary");
  if (summary) {
    summary.innerHTML = `<span>${contracts.length} عقد</span><span>${uniqueProjects.size} مشروع</span><span>تنفيذ ${fmtNum(execRate, 1)}%</span><span>تحصيل ${fmtNum(collectionRate, 1)}%</span><span>متأخر ${fmtNumShort(totalOverdue)}</span>`;
  }

  const gap = document.getElementById("mcExecutionBillingGap");
  if (gap) {
    const gapValue = totalExecValue - totalGross;
    const gapLabel =
      gapValue >= 0 ? "قيمة المستحق من الموقف التنفيذي" : "الفوترة أعلى من التنفيذ";
    gap.innerHTML = `<div><strong>${gapLabel}</strong><span>${fmtNum(gapValue)}</span></div><div><small>التنفيذ / العقد</small><strong>${fmtNum(execRate, 1)}%</strong></div><div><small>المستخلصات / العقد</small><strong>${fmtNum(totalContractValue ? (totalGross / totalContractValue) * 100 : 0, 1)}%</strong></div><div><small>المستخلصات / التنفيذ</small><strong>${fmtNum(totalExecValue ? (totalGross / totalExecValue) * 100 : 0, 1)}%</strong></div>`;
  }

  updateDashboardMeta();
  renderCharts(source, {
    contracts,
    invoices,
    contractMap,
    projectMap,
    ownerMap,
    latestExecutionByContract,
    executionTotal,
    getModifiedTotal: getContractModifiedTotal,
    today,
  });
}

// Presentational header meta for the executive dashboard: last-refresh stamp
// and a readable summary of the currently applied global filters.
// Purely additive — reads existing state, writes to new elements only.
function updateDashboardMeta() {
  const stamp = document.getElementById("mcLastUpdated");
  if (stamp) {
    stamp.innerText = new Date().toLocaleString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  }
  const chipsWrap = document.getElementById("mcActiveFilters");
  if (chipsWrap) {
    const f = state.filters || {};
    const describe = (ids, list) => {
      const names = ids.map((id) => (list.find((x) => x.id === id) || {}).name || id);
      return names.length > 2
        ? `${names.slice(0, 2).join("، ")} +${names.length - 2}`
        : names.join("، ");
    };
    const chips = [];
    if (f.ownerIds.length) chips.push(`المالك: ${describe(f.ownerIds, state.owners)}`);
    if (f.projectIds.length) chips.push(`المشروع: ${describe(f.projectIds, state.projects)}`);
    if (f.projectName) chips.push(`بحث المشروع: ${f.projectName}`);
    if (f.contractIds.length) chips.push(`العقد: ${describe(f.contractIds, state.contracts)}`);
    chipsWrap.innerHTML = chips.length
      ? chips
          .map((c) => `<span class="mc-filter-chip">${escapeHtml(c)}</span>`)
          .join("")
      : `<span class="mc-filter-chip mc-filter-chip-empty">بدون فلاتر — عرض كل البيانات</span>`;
  }
}



function renderCharts(data, context) {
  const {
    contracts,
    invoices,
    contractMap,
    projectMap,
    ownerMap,
    latestExecutionByContract,
    executionTotal,
    today,
  } = context;

  const selectedProjects = state.filters.projectIds
    .map((id) => state.projects.find((p) => p.id === id))
    .filter(Boolean);
  renderDashboardCharts({
    contracts,
    execPositions: state.execPositions,
    getModifiedTotal: getContractModifiedTotal,
    fmtNum,
    projectMap,
    ownerMap: new Map(state.owners.map((owner) => [owner.id, owner])),
    sectorManagers: state.sectorManagers,
    latestExecutionByContract,
    executionTotal,
    invoices,
    contractMap,
    getInvoiceGross,
    getInvoiceNet,
    scopeLabel:
      selectedProjects.length === 1
        ? selectedProjects[0].name
        : selectedProjects.length > 1
          ? `${selectedProjects.length} مشروعات`
          : "",
  });

  const escStatusMap = {
    [ESC_STATUS_PENDING]: 0,
    [ESC_STATUS_PARTIAL]: 0,
    [ESC_STATUS_DONE]: 0,
  };
  invoices.forEach((inv) =>
    (Array.isArray(inv.deductions) ? inv.deductions : []).forEach((d, idx) => {
      if (!d.isRefundable) return;
      if (isSocialInsuranceDeduction(d)) return;
      const response =
        state.escalationsResponses[d.id || `${inv.id}_${idx}`] || {};
      const status = normalizeEscalationStatus(response.responseStatus);
      escStatusMap[status] = (escStatusMap[status] || 0) + 1;
    }),
  );

  const contractAnalytics = contracts.map((c) => {
    const contractInvoices = invoices.filter((inv) => inv.contractId === c.id);
    const gross = contractInvoices.reduce(
      (s, inv) => s + getInvoiceGross(inv),
      0,
    );
    const net = contractInvoices.reduce((s, inv) => s + getInvoiceNet(inv), 0);
    const paidValue = contractInvoices.reduce(
      (s, inv) => s + Math.max(0, parseFloat(inv.paidAmount) || 0),
      0,
    );
    const outstandingValue = Math.max(0, net - paidValue);
    const overdueValue = contractInvoices.reduce((s, inv) => {
      const out = Math.max(
        0,
        getInvoiceNet(inv) - Math.max(0, parseFloat(inv.paidAmount) || 0),
      );
      const due = inv.dueDate ? new Date(inv.dueDate) : null;
      return s + (out > 0 && due && !isNaN(due) && due < today ? out : 0);
    }, 0);
    const execValue = executionTotal(latestExecutionByContract.get(c.id));
    const execPct =
      parseFloat(c.amount) || 0
        ? (execValue / (parseFloat(c.amount) || 0)) * 100
        : 0;
    const collectionPct = net > 0 ? (paidValue / net) * 100 : 0;
    return {
      c,
      gross,
      net,
      paidValue,
      outstandingValue,
      overdueValue,
      execValue,
      execPct,
      collectionPct,
    };
  });

  const attentionBody = document.getElementById("mcAttentionBody");
  if (attentionBody) {
    const riskRank = { حرج: 4, مرتفع: 3, متوسط: 2, طبيعي: 1 };
    const rankedContracts = contractAnalytics.map((r) => {
      const gap = r.execValue - r.gross;
      let risk = "طبيعي";
      if (r.overdueValue > 0 || (r.execPct < 25 && r.execValue > 0))
        risk = "مرتفع";
      if (r.overdueValue > 0 && (r.outstandingValue > 0 || r.execPct < 50))
        risk = "حرج";
      if (r.gross > 0 && r.collectionPct < 50 && r.outstandingValue > 0)
        risk = riskRank[risk] < 3 ? "مرتفع" : risk;
      if (gap > 0 && gap > Math.max(r.gross * 0.25, 1))
        risk = riskRank[risk] < 3 ? "مرتفع" : risk;
      return { ...r, gap, risk };
    });

    // Risk overview strip (presentational summary of the same analysis, no new data source)
    const riskCriticalEl = document.getElementById("mcRiskCriticalCount");
    const riskHighEl = document.getElementById("mcRiskHighCount");
    const riskGapEl = document.getElementById("mcRiskGapCount");
    const riskUnreturnedEl = document.getElementById("mcRiskUnreturnedCount");
    if (riskCriticalEl)
      riskCriticalEl.innerText = fmtNum(
        rankedContracts.filter((r) => r.risk === "حرج").length,
        0,
      );
    if (riskHighEl)
      riskHighEl.innerText = fmtNum(
        rankedContracts.filter((r) => r.risk === "مرتفع").length,
        0,
      );
    if (riskGapEl)
      riskGapEl.innerText = fmtNum(
        rankedContracts.filter(
          (r) => r.gap > 0 && r.gap > Math.max(r.gross * 0.25, 1),
        ).length,
        0,
      );
    if (riskUnreturnedEl)
      riskUnreturnedEl.innerText = fmtNum(
        escStatusMap[ESC_STATUS_PENDING] || 0,
        0,
      );

    const attention = rankedContracts
      .filter((r) => r.risk !== "طبيعي" || r.outstandingValue > 0)
      .sort(
        (a, b) =>
          riskRank[b.risk] - riskRank[a.risk] ||
          b.outstandingValue - a.outstandingValue,
      )
      .slice(0, 15);
    attentionBody.innerHTML = attention.length
      ? attention
          .map((r) => {
            const contract = r.c;
            const project = projectMap.get(contract.projectId) || {};
            const owner = ownerMap.get(project.ownerId) || {};
            const riskClass =
              r.risk === "حرج"
                ? "mc-risk-critical"
                : r.risk === "مرتفع"
                  ? "mc-risk-high"
                  : "mc-risk-medium";
            return `<tr><td><strong>${escapeHtml(contract.name || contract.id || "-")}</strong></td><td>${escapeHtml(owner.name || "-")}</td><td>${escapeHtml(project.name || "-")}</td><td>${fmtNum(parseFloat(contract.amount) || 0)}</td><td>${fmtNum(Math.min(100, r.execPct), 1)}%</td><td>${fmtNum(r.gross)}</td><td>${fmtNum(Math.min(100, r.collectionPct), 1)}%</td><td>${fmtNum(r.outstandingValue)}</td><td>${fmtNum(r.overdueValue)}</td><td class="${r.gap > 0 ? "mc-gap-positive" : "mc-gap-negative"}">${fmtNum(r.gap)}</td><td><span class="mc-risk ${riskClass}">${r.risk}</span></td></tr>`;
          })
          .join("")
      : '<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--gray);">لا توجد عقود تحتاج متابعة وفق البيانات الحالية</td></tr>';
  }
}

function renderOwners(data) {
  let allOwners = data.owners || [];
  // Apply search filter
  const q = (window._searchTerms && window._searchTerms["tblOwners"]) || "";
  if (q) {
    allOwners = allOwners.filter((o) => {
      const projectsOfOwner = data.projects.filter((p) => p.ownerId === o.id);
      const pIds = projectsOfOwner.map((p) => p.id);
      const contractsOfOwner = data.contracts.filter((c) =>
        pIds.includes(c.projectId),
      );
      const cIds = contractsOfOwner.map((c) => c.id);
      const invoicesOfOwner = data.invoices.filter((i) =>
        cIds.includes(i.contractId),
      );
      let totalGross = 0,
        totalPaid = 0;
      invoicesOfOwner.forEach((i) => {
        totalGross += getInvoiceGross(i);
        totalPaid += parseFloat(i.paidAmount) || 0;
      });
      const searchText =
        `${o.id} ${o.name} ${o.phone || ""} ${projectsOfOwner.length} ${fmtNum(totalGross)} ${fmtNum(totalPaid)}`.toLowerCase();
      return searchText.includes(q);
    });
  }
  renderPaginatedTable(
    "owners",
    allOwners,
    "ownersPagination",
    "#tblOwners tbody",
    7,
    (slicedOwners) => {
      slicedOwners.forEach((o) => {
        const projectsOfOwner = data.projects.filter((p) => p.ownerId === o.id);
        const pIds = projectsOfOwner.map((p) => p.id);
        const contractsOfOwner = data.contracts.filter((c) =>
          pIds.includes(c.projectId),
        );
        const cIds = contractsOfOwner.map((c) => c.id);
        const invoicesOfOwner = data.invoices.filter((i) =>
          cIds.includes(i.contractId),
        );

        let totalGross = 0;
        let totalPaid = 0;
        invoicesOfOwner.forEach((i) => {
          totalGross += getInvoiceGross(i);
          totalPaid += parseFloat(i.paidAmount) || 0;
        });

        const tr = document.createElement("tr");
        tr.innerHTML = `
                <td>${o.id}</td>
                <td><strong>${o.name}</strong></td>
                <td>${o.phone || "-"}</td>
                <td>${projectsOfOwner.length}</td>
                <td>${fmtNum(totalGross)}</td>
                <td>${fmtNum(totalPaid)}</td>
                <td>
                    <div class="row-actions">
                        ${hasPermission("owners", "edit") ? `<button type="button" class="btn-icon btn-icon-edit btn-edit" title="تعديل" onclick="editOwner('${o.id}')">${ICON_BTN_EDIT}</button>` : ""}
                        ${hasPermission("owners", "delete") ? `<button type="button" class="btn-icon btn-icon-delete btn-delete" title="حذف" onclick="deleteOwner('${o.id}')">${ICON_BTN_DELETE}</button>` : ""}
                    </div>
                </td>
            `;
        document.querySelector("#tblOwners tbody").appendChild(tr);
      });
    },
  );
}

function renderProjects(data) {
  let allProjects = data.projects || [];
  const q = (window._searchTerms && window._searchTerms["tblProjects"]) || "";
  if (q) {
    allProjects = allProjects.filter((p) => {
      const owner = data.owners.find((o) => o.id === p.ownerId) || {
        name: "-",
      };
      const contractsOfProj = data.contracts.filter(
        (c) => c.projectId === p.id,
      );
      let totalGross = 0;
      contractsOfProj.forEach((c) =>
        data.invoices
          .filter((i) => c.id === i.contractId)
          .forEach((i) => (totalGross += getInvoiceGross(i))),
      );
      const manager = (state.sectorManagers || []).find((m) => m.id === p.sectorManagerId);
      const managerName = manager ? manager.displayName : "";
      const searchText =
        `${p.id} ${p.name} ${owner.name} ${managerName} ${contractsOfProj.length} ${fmtNum(totalGross)} ${p.status || ""} ${fmtDisplayDate(p.startDate)}`.toLowerCase();
      return searchText.includes(q);
    });
  }
  renderPaginatedTable(
    "projects",
    allProjects,
    "projectsPagination",
    "#tblProjects tbody",
    8,
    (slicedProjects) => {
      slicedProjects.forEach((p) => {
        const owner = data.owners.find((o) => o.id === p.ownerId) || {
          name: "-",
        };
        const manager = (state.sectorManagers || []).find((m) => m.id === p.sectorManagerId);
        const managerName = manager ? manager.displayName : "";
        const contractsOfProj = data.contracts.filter(
          (c) => c.projectId === p.id,
        );
        const cIds = contractsOfProj.map((c) => c.id);
        const invoicesOfProj = data.invoices.filter((i) =>
          cIds.includes(i.contractId),
        );

        let totalGross = 0;
        invoicesOfProj.forEach((i) => (totalGross += getInvoiceGross(i)));

        const statusBadge =
          p.status === "Active"
            ? '<span class="badge badge-success">نشط</span>'
            : '<span class="badge badge-warning">متوقف/مكتمل</span>';

        const tr = document.createElement("tr");
        tr.innerHTML = `
                <td>${p.id}</td>
                <td><strong>${p.name}</strong></td>
                <td>${owner.name}</td>
                <td>${managerName ? `<span>${managerName}</span>` : '<span style="color:#94a3b8;">—</span>'}</td>
                <td>${contractsOfProj.length}</td>
                <td>${fmtNum(totalGross)}</td>
                <td>${statusBadge}</td>
                <td>${fmtDisplayDate(p.startDate)}</td>
                <td>
                    <div class="row-actions">
                        ${hasPermission("projects", "edit") ? `<button type="button" class="btn-icon btn-icon-edit btn-edit" title="تعديل" onclick="editProject('${p.id}')">${ICON_BTN_EDIT}</button>` : ""}
                        ${hasPermission("projects", "delete") ? `<button type="button" class="btn-icon btn-icon-delete btn-delete" title="حذف" onclick="deleteProject('${p.id}')">${ICON_BTN_DELETE}</button>` : ""}
                    </div>
                </td>
            `;
        document.querySelector("#tblProjects tbody").appendChild(tr);
      });
    },
  );
}

/** إجمالي قيمة العقد المعدل = حصر البنود + VO + التفويضات + الضريبة المضافة */
function getContractModifiedTotal(c) {
  if (!c) return 0;
  return (
    (parseFloat(c.modifiedAmount) || 0) +
    (parseFloat(c.voAmount) || 0) +
    (parseFloat(c.claimsAmount) || 0) +
    (parseFloat(c.vatAmount) || 0)
  );
}

function renderContracts(data) {
  let allContracts = data.contracts || [];
  const q = (window._searchTerms && window._searchTerms["tblContracts"]) || "";
  if (q) {
    allContracts = allContracts.filter((c) => {
      const proj = data.projects.find((p) => p.id === c.projectId) || {
        name: "-",
      };
      const invoicesOfCont = data.invoices.filter((i) => c.id === i.contractId);
      let totalGross = 0;
      invoicesOfCont.forEach((i) => (totalGross += getInvoiceGross(i)));
      const contractAmt = parseFloat(c.amount) || 0;
      const execRate =
        contractAmt > 0 ? Math.min(100, (totalGross / contractAmt) * 100) : 0;
      const modTotal = getContractModifiedTotal(c);
      const searchText =
        `${c.id} ${c.name} ${proj.name} ${fmtNum(contractAmt)} ${fmtNum(modTotal)} ${fmtNum(totalGross)} ${fmtNum(execRate, 1)}% ${c.paymentTerms || 45} ${fmtDisplayDate(c.endDate)} ${c.status || ""}`.toLowerCase();
      return searchText.includes(q);
    });
  }
  renderPaginatedTable(
    "contracts",
    allContracts,
    "contractsPagination",
    "#tblContracts tbody",
    10,
    (slicedContracts) => {
      slicedContracts.forEach((c) => {
        const proj = data.projects.find((p) => p.id === c.projectId) || {
          name: "-",
        };
        const invoicesOfCont = data.invoices.filter(
          (i) => c.id === i.contractId,
        );

        let totalGross = 0;
        invoicesOfCont.forEach((i) => (totalGross += getInvoiceGross(i)));

        const contractAmt = parseFloat(c.amount) || 0;
        const execRate =
          contractAmt > 0 ? Math.min(100, (totalGross / contractAmt) * 100) : 0;
        const statusBadge =
          c.status === "Active"
            ? '<span class="badge badge-success">ساري</span>'
            : '<span class="badge badge-danger">منتهي</span>';

        const tr = document.createElement("tr");
        tr.innerHTML = `
                <td>${c.id}</td>
                <td><strong>${c.name}</strong></td>
                <td>${proj.name}</td>
                <td>${fmtNum(contractAmt)}</td>
                <td>${fmtNum(getContractModifiedTotal(c))}</td>
                <td>${fmtNum(totalGross)}</td>
                <td>${fmtNum(execRate, 1)}%</td>
                <td>${c.paymentTerms || 45}</td>
                <td>${fmtDisplayDate(c.endDate)}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="row-actions">
                        ${hasPermission("contracts", "edit") ? `<button type="button" class="btn-icon btn-icon-edit btn-edit" title="تعديل" onclick="editContract('${c.id}')">${ICON_BTN_EDIT}</button>` : ""}
                        ${hasPermission("contracts", "delete") ? `<button type="button" class="btn-icon btn-icon-delete btn-delete" title="حذف" onclick="deleteContract('${c.id}')">${ICON_BTN_DELETE}</button>` : ""}
                    </div>
                </td>
            `;
        document.querySelector("#tblContracts tbody").appendChild(tr);
      });
    },
  );
}

function renderInvoices(data) {
  let allInvoices = data.invoices || [];

  // ترتيب المستخلصات حسب التاريخ — الافتراضي: الأحدث أولاً (desc)
  // يتبدل عند الضغط على سهم عمود التاريخ في رأس الجدول
  if (typeof window._invDateSortDir === "undefined")
    window._invDateSortDir = "desc";
  const dateDir = window._invDateSortDir === "asc" ? "asc" : "desc";
  allInvoices = [...allInvoices].sort((a, b) => {
    const da = a.date || "";
    const db = b.date || "";
    if (da !== db) {
      return dateDir === "desc" ? db.localeCompare(da) : da.localeCompare(db);
    }
    const numCmp = String(a.number || "").localeCompare(
      String(b.number || ""),
      "ar",
      { numeric: true },
    );
    return dateDir === "desc" ? -numCmp : numCmp;
  });

  const q = (window._searchTerms && window._searchTerms["tblInvoices"]) || "";
  if (q) {
    allInvoices = allInvoices.filter((inv) => {
      const contract =
        state.contracts.find((c) => c.id === inv.contractId) || {};
      const project =
        state.projects.find((p) => p.id === contract.projectId) || {};
      const owner = state.owners.find((o) => o.id === project.ownerId) || {};
      const gross = getInvoiceGross(inv);
      const net = getInvoiceNet(inv);
      const searchText =
        `${inv.number} ${contract.name || ""} ${project.name || ""} ${owner.name || ""} ${fmtDisplayDate(inv.date)} ${fmtDisplayDate(inv.dueDate)} ${fmtNum(gross)} ${fmtNum(net)} ${inv.status || ""} ${inv.paymentStatus || ""}`.toLowerCase();
      return searchText.includes(q);
    });
  }
  renderPaginatedTable(
    "invoices",
    allInvoices,
    "invoicesPagination",
    "#tblInvoices tbody",
    11,
    (slicedInvoices) => {
      slicedInvoices.forEach((inv) => {
        const contract =
          state.contracts.find((c) => c.id === inv.contractId) || {};
        const project =
          state.projects.find((p) => p.id === contract.projectId) || {};
        const owner = state.owners.find((o) => o.id === project.ownerId) || {};

        const gross = getInvoiceGross(inv);
        const net = getInvoiceNet(inv);

        const stBadge =
          {
            Draft: '<span class="badge badge-warning">مسودة</span>',
            Review: '<span class="badge badge-primary">مراجعة</span>',
            Approved: '<span class="badge badge-success">معتمد</span>',
            Rejected: '<span class="badge badge-danger">مرفوض</span>',
          }[inv.status] || '<span class="badge badge-warning">مسودة</span>';

        const payBadge =
          {
            Pending: '<span class="badge badge-warning">معلق</span>',
            Paid: '<span class="badge badge-success">مدفوع</span>',
            Partial: '<span class="badge badge-primary">جزئي</span>',
          }[inv.paymentStatus] ||
          '<span class="badge badge-warning">معلق</span>';

        const tr = document.createElement("tr");
        tr.setAttribute("data-id", inv.id);
        tr.innerHTML = `
                <td><strong>${inv.number}</strong></td>
                <td>${contract.name || "-"}</td>
                <td>${project.name || "-"}</td>
                <td>${owner.name || "-"}</td>
                <td>${fmtDisplayDate(inv.date)}</td>
                <td>${fmtDisplayDate(inv.dueDate)}</td>
                <td>${fmtNum(gross)}</td>
                <td>${fmtNum(net)}</td>
                <td>${stBadge}</td>
                <td>${payBadge}</td>
                <td>
                    <div class="row-actions">
                        <button type="button" class="btn-icon btn-icon-print" title="طباعة المستخلص" data-action="printInvoice" data-id="${inv.id}">${ICON_BTN_PRINT}</button>
                        ${hasPermission("invoices", "edit") ? `<button type="button" class="btn-icon btn-icon-edit btn-edit" title="تعديل" data-action="editInvoice" data-id="${inv.id}">${ICON_BTN_EDIT}</button>` : ""}
                        ${hasPermission("invoices", "delete") ? `<button type="button" class="btn-icon btn-icon-delete btn-delete" title="حذف" data-action="deleteInvoice" data-id="${inv.id}">${ICON_BTN_DELETE}</button>` : ""}
                    </div>
                </td>
            `;
        document.querySelector("#tblInvoices tbody").appendChild(tr);
      });
    },
  );
  SummaryEngine.update("invoices");
  updateInvoiceDateSortIndicator(
    document.querySelector('#tblInvoices thead th[data-sort-bound="1"]'),
  );
}

function renderExecPosition(data) {
  const projectSelect = document.getElementById("execProjectSelect");
  const contractSelect = document.getElementById("execContractSelect");
  if (!contractSelect) return;

  const prevProject = projectSelect ? projectSelect.value : "";
  const prevContract = contractSelect.value;

  if (projectSelect) {
    const projects =
      data.projects || filteredData.projects || state.projects || [];
    projectSelect.innerHTML =
      '<option value="">كل المشروعات</option>' +
      projects
        .map((p) => `<option value="${p.id}">${p.name || p.id}</option>`)
        .join("");
    if (prevProject && projects.some((p) => p.id === prevProject)) {
      projectSelect.value = prevProject;
    }
  }

  fillExecContractOptions(prevContract);
  loadExecPositionForSelectedContract();
}

function fillExecContractOptions(preferredContractId) {
  const projectSelect = document.getElementById("execProjectSelect");
  const contractSelect = document.getElementById("execContractSelect");
  if (!contractSelect) return;

  // المشروع المختار في صفحة الموقف (مش الفلتر العام)
  const projectId = projectSelect
    ? String(projectSelect.value || "").trim()
    : "";

  // قائمة العقود من state كاملة حتى يظهر كل عقود المشروع
  let contracts = (state.contracts || []).slice();
  if (projectId) {
    contracts = contracts.filter((c) => String(c.projectId) === projectId);
  }

  contractSelect.innerHTML =
    `<option value="">${projectId ? "كل عقود المشروع (إجمالي)" : "— اختر عقد —"}</option>` +
    contracts
      .map((c) => `<option value="${c.id}">${c.name || c.id}</option>`)
      .join("");

  // لو مشروع محدد → الافتراضي = إجمالي كل العقود (قيمة فاضي)
  // لو مفيش مشروع → اختار عقد لو اتبعت preferred فقط، وإلا سيب فاضي
  if (projectId) {
    if (
      preferredContractId &&
      contracts.some((c) => c.id === preferredContractId)
    ) {
      contractSelect.value = preferredContractId;
    } else {
      contractSelect.value = ""; // إجمالي المشروع
    }
  } else if (
    preferredContractId &&
    contracts.some((c) => c.id === preferredContractId)
  ) {
    contractSelect.value = preferredContractId;
  } else {
    contractSelect.value = "";
  }
}

let _execHistoryLastContractId = "";
function loadExecPositionForSelectedContract() {
  const projectSelect = document.getElementById("execProjectSelect");
  const contractSelect = document.getElementById("execContractSelect");
  if (!contractSelect) return;

  const projectId = projectSelect
    ? String(projectSelect.value || "").trim()
    : "";
  const contractId = String(contractSelect.value || "").trim();

  // مشروع محدد + من غير عقد → إجمالي كل عقود هذا المشروع (المتحكم = المشروع)
  if (projectId && !contractId) {
    loadExecPositionForProjectAggregate(projectId);
    return;
  }

  // لا مشروع ولا عقد → لا تحمّل بيانات عقد قديم
  if (!contractId) {
    clearExecPositionForm();
    return;
  }

  if (contractId !== _execHistoryLastContractId) {
    _execHistoryLastContractId = contractId;
    if (typeof _resetPagination === "function") _resetPagination("execHistory");
  }

  const contract = state.contracts.find((c) => c.id === contractId) || {};
  const contractAmount = parseFloat(contract.amount) || 0;

  const positions = state.execPositions.filter(
    (e) => e.contractId === contractId,
  );
  positions.sort(
    (a, b) =>
      new Date(a.date) - new Date(b.date) || a.versionNumber - b.versionNumber,
  );

  const latest = positions.length > 0 ? positions[positions.length - 1] : null;

  const keys = ["workVolume", "variationOrders", "materials", "claims", "vat"];
  keys.forEach((k) => {
    const cumInput = document.getElementById(`exec_${k}_cum`);
    const currInput = document.getElementById(`exec_${k}_curr`);
    if (cumInput) {
      cumInput.value = latest ? latest[k] || 0 : 0;
      cumInput.readOnly = false;
    }
    if (currInput) currInput.value = latest ? latest[k] || 0 : 0;
  });

  recalcExecPositionInputs();
  renderExecHistoryTable(positions, false);

  const invoices = state.invoices.filter((i) => i.contractId === contractId);
  updateExecComparisonAndKpis(contractAmount, latest, invoices);
}

function clearExecPositionForm() {
  const keys = ["workVolume", "variationOrders", "materials", "claims", "vat"];
  keys.forEach((k) => {
    const cum = document.getElementById("exec_" + k + "_cum");
    const curr = document.getElementById("exec_" + k + "_curr");
    if (cum) {
      cum.value = 0;
      cum.readOnly = false;
    }
    if (curr) curr.value = 0;
  });
  if (typeof recalcExecPositionInputs === "function")
    recalcExecPositionInputs();
  updateExecComparisonAndKpis(0, null, []);
  const tbody = document.querySelector("#tblExecHistory tbody");
  if (tbody) tbody.innerHTML = "";
}

function loadExecPositionForProjectAggregate(projectId) {
  // كل عقود المشروع من state (مش بس الفلتر العام)
  const contracts = (state.contracts || []).filter(
    (c) => String(c.projectId) === String(projectId),
  );
  const contractIds = new Set(contracts.map((c) => c.id));
  const contractAmount = contracts.reduce((s, c) => {
    const base = parseFloat(c.amount) || 0;
    const mod = parseFloat(c.modifiedAmount) || 0;
    // قيمة العرض: المعدّل إن وُجد وإلا الأصلي
    return s + (mod !== 0 ? mod : base);
  }, 0);

  const keys = ["workVolume", "variationOrders", "materials", "claims", "vat"];
  const totals = {
    workVolume: 0,
    variationOrders: 0,
    materials: 0,
    claims: 0,
    vat: 0,
  };

  contracts.forEach((c) => {
    const positions = state.execPositions
      .filter((e) => e.contractId === c.id)
      .sort(
        (a, b) =>
          new Date(a.date) - new Date(b.date) ||
          a.versionNumber - b.versionNumber,
      );
    const latest = positions.length ? positions[positions.length - 1] : null;
    if (!latest) return;
    keys.forEach((k) => {
      totals[k] += parseFloat(latest[k]) || 0;
    });
  });

  keys.forEach((k) => {
    const cumInput = document.getElementById(`exec_${k}_cum`);
    const currInput = document.getElementById(`exec_${k}_curr`);
    if (cumInput) {
      cumInput.value = totals[k];
      cumInput.readOnly = true;
    }
    if (currInput) currInput.value = totals[k];
  });

  recalcExecPositionInputs();

  const historyData = state.execPositions
    .filter((e) => contractIds.has(e.contractId))
    .sort(
      (a, b) =>
        new Date(a.date) - new Date(b.date) ||
        a.versionNumber - b.versionNumber,
    );

  renderExecHistoryTable(historyData, true);

  const invoices = state.invoices.filter((i) => contractIds.has(i.contractId));
  updateExecComparisonAndKpis(contractAmount, totals, invoices);
}

function renderExecHistoryTable(positions, isAggregate) {
  const historyData = positions.slice().reverse();
  if (typeof renderPaginatedTable !== "function") return;
  renderPaginatedTable(
    "execHistory",
    historyData,
    "execHistoryPagination",
    "#tblExecHistory tbody",
    5,
    (slice) => {
      const tbody = document.querySelector("#tblExecHistory tbody");
      if (!tbody) return;
      tbody.innerHTML = "";
      slice.forEach((pos) => {
        const total =
          (parseFloat(pos.workVolume) || 0) +
          (parseFloat(pos.variationOrders) || 0) +
          (parseFloat(pos.materials) || 0) +
          (parseFloat(pos.claims) || 0) +
          (parseFloat(pos.vat) || 0);
        const cName = isAggregate
          ? ((state.contracts.find((c) => c.id === pos.contractId) || {})
              .name || pos.contractId) + " — "
          : "";
        const tr = document.createElement("tr");
        tr.innerHTML = `
                    <td>${cName}إصدار #${pos.versionNumber}</td>
                    <td>${fmtDisplayDate(pos.date)}</td>
                    <td>${pos.user || pos.User || "-"}</td>
                    <td>${fmtNum(total)}</td>
                    <td>
                        ${
                          !isAggregate &&
                          hasPermission("execPosition", "delete")
                            ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteExecVersion('${pos.id}')">حذف</button>`
                            : ""
                        }
                    </td>`;
        tbody.appendChild(tr);
      });
    },
  );
}

function updateExecComparisonAndKpis(contractAmount, latest, invoices) {
  const keys = ["workVolume", "variationOrders", "materials", "claims", "vat"];
  let totalExecSum = 0;
  let totalInvSum = 0;
  const invList = invoices || [];

  keys.forEach((k) => {
    const exVal = latest ? parseFloat(latest[k]) || 0 : 0;
    let inVal = 0;
    invList.forEach((inv) => {
      // قيم المكونات على المستخلص (أو 0)
      inVal +=
        parseFloat(inv[k] ?? inv[k.charAt(0).toUpperCase() + k.slice(1)]) || 0;
    });
    totalExecSum += exVal;
    totalInvSum += inVal;
    const diff = exVal - inVal;
    const cellEx = document.getElementById("comp_exec_" + k);
    const cellIn = document.getElementById("comp_inv_" + k);
    const cellDiff = document.getElementById("comp_diff_" + k);
    if (cellEx) cellEx.innerText = fmtNum(exVal);
    if (cellIn) cellIn.innerText = fmtNum(inVal);
    if (cellDiff) {
      cellDiff.innerText = fmtNum(diff);
      cellDiff.className =
        diff > 0 ? "diff-positive" : diff < 0 ? "diff-negative" : "diff-zero";
    }
  });

  // لو مجموع المكونات للمستخلصات = 0 استخدم الصافي/الإجمالي كمرجع إضافي للـ KPI فقط
  let invGrossFallback = 0;
  invList.forEach((inv) => {
    if (typeof getInvoiceGross === "function")
      invGrossFallback += getInvoiceGross(inv) || 0;
  });
  if (totalInvSum === 0 && invGrossFallback > 0) {
    totalInvSum = invGrossFallback;
    if (document.getElementById("comp_inv_total")) {
      // لا نكسر تفصيل الصفوف؛ نحدّث الإجمالي فقط عند غياب المكونات
    }
  }

  const el = (id) => document.getElementById(id);
  if (el("comp_exec_total"))
    el("comp_exec_total").innerText = fmtNum(totalExecSum);
  if (el("comp_inv_total"))
    el("comp_inv_total").innerText = fmtNum(totalInvSum);
  const totalDiff = totalExecSum - totalInvSum;
  const compTotalDiffEl = el("comp_diff_total");
  if (compTotalDiffEl) {
    compTotalDiffEl.innerText = fmtNum(totalDiff);
    compTotalDiffEl.className =
      totalDiff > 0
        ? "diff-positive"
        : totalDiff < 0
          ? "diff-negative"
          : "diff-zero";
  }
  if (el("execKpiContractAmount"))
    el("execKpiContractAmount").innerText = fmtNum(contractAmount);
  if (el("execKpiTotalExec"))
    el("execKpiTotalExec").innerText = fmtNum(totalExecSum);
  if (el("execKpiTotalInvoices"))
    el("execKpiTotalInvoices").innerText = fmtNum(totalInvSum);
  if (el("execKpiDiff"))
    el("execKpiDiff").innerText = fmtNum(totalExecSum - totalInvSum);
  if (el("execKpiExecRate"))
    el("execKpiExecRate").innerText =
      fmtNum(
        contractAmount > 0 ? (totalExecSum / contractAmount) * 100 : 0,
        1,
      ) + "%";
  if (el("execKpiInvRate"))
    el("execKpiInvRate").innerText =
      fmtNum(contractAmount > 0 ? (totalInvSum / contractAmount) * 100 : 0, 1) +
      "%";
}

function recalcExecPositionInputs() {
  const keys = ["workVolume", "variationOrders", "materials", "claims", "vat"];
  let totalCum = 0;

  keys.forEach((k) => {
    const cum =
      parseFloat(document.getElementById(`exec_${k}_cum`)?.value) || 0;

    const currInput = document.getElementById(`exec_${k}_curr`);
    if (currInput) currInput.value = cum;

    totalCum += cum;
  });

  document.getElementById("execTotalCumCell").innerText = fmtNum(totalCum);
  document.getElementById("execTotalCurrCell").innerText = fmtNum(totalCum);
}

async function saveExecPosition() {
  const contractId = document.getElementById("execContractSelect").value;
  if (!contractId) {
    alert(
      "لحفظ موقف تنفيذي يجب اختيار عقد محدد (وضع إجمالي المشروع للعرض فقط)",
    );
    return;
  }
  const date = document.getElementById("execDateInput").value;

  if (!contractId || !date) {
    alert("يرجى اختيار العقد وتاريخ الموقف التنفيذي");
    return;
  }

  const keys = ["workVolume", "variationOrders", "materials", "claims", "vat"];
  let me = null;
  try {
    me = typeof currentUser === "function" ? currentUser() : null;
  } catch (_) {
    me = null;
  }
  if (!me) {
    try {
      me = JSON.parse(sessionStorage.getItem("erp_auth_session") || "null");
    } catch (_) {
      me = null;
    }
  }
  const actorName =
    String(
      (me &&
        (me.displayName || me.DisplayName || me.username || me.Username)) ||
        "",
    ).trim() || "مستخدم";
  const dataObj = {
    id: null,
    contractId,
    date: toDateOnly(date),
    user: actorName,
  };

  let totalAmount = 0;
  keys.forEach((k) => {
    const val =
      parseFloat(document.getElementById(`exec_${k}_cum`)?.value) || 0;
    dataObj[k] = val;
    totalAmount += val;
  });
  dataObj.totalAmount = totalAmount;

  const existing = state.execPositions.filter(
    (e) => e.contractId === contractId,
  );
  dataObj.versionNumber = existing.length + 1;

  try {
    await erpApi.execPositions.create(dataObj);
    await syncStateFromBackend();
    applyGlobalFilters();
    alert("تم حفظ إصدار الموقف التنفيذي بنجاح");
  } catch (error) {
    console.error("Save exec position failed:", error);
    alert("حدث خطأ أثناء حفظ الموقف التنفيذي: " + (error.message || ""));
  }
}

async function deleteLastExecVersion() {
  const contractId = document.getElementById("execContractSelect").value;
  if (!contractId) return;

  const existing = state.execPositions.filter(
    (e) => e.contractId === contractId,
  );
  if (existing.length === 0) {
    alert("لا توجد إصدارات لحذفها");
    return;
  }

  existing.sort((a, b) => b.versionNumber - a.versionNumber);
  const lastId = existing[0].id;

  try {
    await erpApi.execPositions.remove(lastId);
    await syncStateFromBackend();
    applyGlobalFilters();
    alert("تم حذف آخر إصدار بنجاح");
  } catch (error) {
    console.error("Delete exec version failed:", error);
    alert("حدث خطأ أثناء حذف الإصدار: " + (error.message || ""));
  }
}

async function deleteExecVersion(id) {
  if (
    !(await erpNotify.showConfirm("هل أنت متأكد من حذف هذا الإصدار؟", {
      title: "تأكيد الحذف",
      confirmText: "حذف",
      cancelText: "إلغاء",
    }))
  )
    return;
  try {
    await erpApi.execPositions.remove(id);
    await syncStateFromBackend();
    applyGlobalFilters();
  } catch (error) {
    console.error("Delete exec version failed:", error);
    alert("حدث خطأ أثناء حذف الإصدار: " + (error.message || ""));
  }
}

function getSocialInsuranceEscalationView(inv) {
  syncSocialInsuranceFromInvoice(inv);
  const payment = state.socialInsurance?.payments?.[inv.id] || {};
  const amount = getSocialInsuranceDeductionAmount(inv);
  const paid = Math.min(
    amount,
    Math.max(0, parseFloat(payment.paidAmount) || 0),
  );
  const outstanding = Math.max(0, amount - paid);
  const status =
    paid >= amount && amount > 0
      ? "مسدد"
      : paid > 0
        ? "مسدد جزئياً"
        : "غير مسدد";
  return { payment, amount, paid, outstanding, status };
}

function ensureEscStatusFilterUI() {
  if (document.getElementById("escPageStatusFilter")) return;

  const searchInput = document.getElementById("searchEscalations");
  const filterWrap = document.createElement("div");
  filterWrap.style.cssText =
    "display:flex;flex-wrap:wrap;gap:0.75rem;align-items:flex-end;";
  filterWrap.innerHTML = `
        <div class="form-group" style="min-width:200px;margin:0">
            <label for="escPageStatusFilter" style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.25rem">حالة الرد</label>
            <select class="form-select" id="escPageStatusFilter">
                <option value="${ESC_FILTER_ALL}">الكل</option>
                <option value="${ESC_FILTER_NOT_REPLIED}">غير قابلة للرد</option>
                <option value="${ESC_FILTER_REPLYABLE}">قابلة للرد</option>
            </select>
        </div>
        <div class="form-group" id="escPageStatusDetailWrap" style="min-width:200px;margin:0;display:none">
            <label for="escPageStatusDetailFilter" style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.25rem">تفصيل حالة قابلة للرد</label>
            <select class="form-select" id="escPageStatusDetailFilter">
                <option value="${ESC_FILTER_ALL}">كل الحالات</option>
                <option value="${ESC_FILTER_REPLIED}">تم الرد</option>
                <option value="${ESC_FILTER_UNPAID}">غير مسدد</option>
            </select>
        </div>`;

  // حط الفلتر جنب خانة «بحث في جميع الأعمدة»
  if (searchInput) {
    const parent = searchInput.parentElement || searchInput;
    const row = parent.parentElement || parent;
    // غلاف أفقي
    let bar = document.getElementById("escToolbarFilters");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "escToolbarFilters";
      bar.style.cssText =
        "display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;margin-bottom:0.75rem;width:100%;justify-content:flex-start;";
      // لف خانة البحث داخل البار لو مش جواه
      if (searchInput.parentElement && searchInput.parentElement !== bar) {
        const searchWrap =
          searchInput.closest(".form-group") || searchInput.parentElement;
        row.insertBefore(bar, searchWrap);
        bar.appendChild(searchWrap);
      } else {
        row.insertBefore(bar, searchInput);
        bar.appendChild(searchInput);
      }
    }
    bar.appendChild(filterWrap);
  } else {
    const table = document.getElementById("tblEscalations");
    if (!table) return;
    const host = table.closest(".table-container") || table.parentElement;
    if (!host) return;
    filterWrap.style.margin = "0 0 0.85rem";
    host.insertBefore(filterWrap, host.firstChild);
  }

  document
    .getElementById("escPageStatusFilter")
    .addEventListener("change", filterEscalationsByStatus);
  document
    .getElementById("escPageStatusDetailFilter")
    .addEventListener("change", filterEscalationsByStatus);
}

function renderEscalations(data) {
  ensureEscStatusFilterUI();
  const tbody = document.querySelector("#tblEscalations tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  data.invoices.forEach((inv) => {
    if (inv.deductions && Array.isArray(inv.deductions)) {
      inv.deductions.forEach((d, idx) => {
        // كل الاستقطاعات تظهر في التعليات سواء متابعة نعم أو لا
        const amt = parseFloat(d.amount) || parseFloat(d.val) || 0;
        const escKey = d.id || `${inv.id}_${idx}`;
        const isInsuranceEscalation = isSocialInsuranceDeduction(d);
        const insuranceView = isInsuranceEscalation
          ? getSocialInsuranceEscalationView(inv)
          : null;
        const resp = state.escalationsResponses[escKey] || {};
        const status = isInsuranceEscalation
          ? insuranceView.status
          : normalizeEscalationStatus(resp.responseStatus);
        const respDate = isInsuranceEscalation
          ? insuranceView.payment.paymentDate || ""
          : resp.responseDate || "";

        // Map social insurance status onto the canonical escalation status.
        let mappedStatus = status;
        if (isInsuranceEscalation) {
          if (insuranceView.status === "مسدد") mappedStatus = ESC_STATUS_DONE;
          else if (insuranceView.status === "غير مسدد")
            mappedStatus = ESC_STATUS_PENDING;
          else if (insuranceView.status === "مسدد جزئياً")
            mappedStatus = ESC_STATUS_PARTIAL;
        }

        const days = computeEscalationDays(inv.date, mappedStatus, respDate);
        const filterStatus = isInsuranceEscalation
          ? insuranceView.status === "غير مسدد"
            ? ESC_FILTER_UNPAID
            : ESC_FILTER_REPLIED
          : status === ESC_STATUS_PENDING
            ? ESC_FILTER_NOT_REPLIED
            : ESC_FILTER_REPLIED;

        const contract =
          state.contracts.find((c) => c.id === inv.contractId) || {};
        const project =
          state.projects.find((p) => p.id === contract.projectId) || {};
        const owner = state.owners.find((o) => o.id === project.ownerId) || {};

        const tr = document.createElement("tr");
        tr.setAttribute("data-key", escKey);
        tr.setAttribute("data-amt", amt);
        tr.setAttribute("data-status", mappedStatus);
        tr.setAttribute("data-filter-status", filterStatus);

        // ---- Fixed 11-column structure for EVERY row ----
        // 1 inv#  2 invDate  3 owner  4 project  5 contract
        // 6 desc  7 amount  8 status  9 respDate  10 retAmt  11 days

        if (isInsuranceEscalation) {
          const paymentReference = insuranceView.payment.reference || "-";
          const paidText = fmtNum(insuranceView.paid);
          const outstandingText = fmtNum(insuranceView.outstanding);
          tr.setAttribute("data-ret-amt", insuranceView.paid);
          tr.style.background = "var(--light)";
          tr.innerHTML = `
                        <td class="col-inv-no"><strong>${inv.number}</strong></td>
                        <td class="col-inv-date">${fmtDisplayDate(inv.date)}</td>
                        <td class="col-owner">${owner.name || "-"}</td>
                        <td class="col-project">${project.name || "-"}</td>
                        <td class="col-contract">${contract.name || "-"}</td>
                        <td class="col-desc">
                            <strong>تعلية تأمينات اجتماعية</strong>
                            <div class="esc-subtext">${d.description || "تعلية تأمينات اجتماعية"}</div>
                            <div class="esc-subtext esc-hint">تُتابع وتُسدد من شاشة التأمينات الاجتماعية</div>
                        </td>
                        <td class="col-amount">${fmtNum(insuranceView.amount)}</td>
                        <td class="col-status">
                            ${socialInsuranceStatusBadge(insuranceView.status)}
                            <div class="esc-subtext">المدفوع: ${paidText}</div>
                            <div class="esc-subtext">المتبقي: ${outstandingText}</div>
                            <div class="esc-subtext">مرجع: ${paymentReference}</div>
                        </td>
                        <td class="col-resp-date">${fmtDisplayDate(insuranceView.payment.paymentDate) || "—"}</td>
                        <td class="col-ret-amt">${paidText}</td>
                        <td class="col-days"><span class="days-value">${days}</span> <span class="days-unit">يوم</span></td>
                    `;
        } else {
          const retAmt =
            resp.returnedAmount !== undefined
              ? parseFloat(resp.returnedAmount) || 0
              : 0;
          const showRetAmt =
            status === ESC_STATUS_DONE || status === ESC_STATUS_PARTIAL;
          tr.setAttribute("data-ret-amt", showRetAmt ? retAmt : 0);
          // Always render the same cells; enable/disable content by status.
          const dateDisabled = !showRetAmt ? "disabled" : "";
          const retCell = showRetAmt
            ? `<input type="number" step="any" class="form-control esc-ret-ctrl" data-key="${escKey}" value="${retAmt}" min="0" max="${amt}" title="المبلغ المُردّ">`
            : `<span class="esc-empty">—</span>`;
          const dateCell = `<input type="date" class="form-control esc-date-ctrl" data-key="${escKey}" value="${respDate}" lang="ar" ${dateDisabled}>`;
          const statusCell =
            status === ESC_STATUS_PENDING
              ? `<span class="badge badge-primary">${ESC_STATUS_PENDING}</span>`
              : `<select class="form-select esc-status-ctrl" data-key="${escKey}">
                    <option value="${ESC_STATUS_PARTIAL}" ${status === ESC_STATUS_PARTIAL ? "selected" : ""}>${ESC_STATUS_PARTIAL}</option>
                    <option value="${ESC_STATUS_DONE}" ${status === ESC_STATUS_DONE ? "selected" : ""}>${ESC_STATUS_DONE}</option>
                </select>`;

          tr.innerHTML = `
                        <td class="col-inv-no"><strong>${inv.number}</strong></td>
                        <td class="col-inv-date">${fmtDisplayDate(inv.date)}</td>
                        <td class="col-owner">${owner.name || "-"}</td>
                        <td class="col-project">${project.name || "-"}</td>
                        <td class="col-contract">${contract.name || "-"}</td>
                        <td class="col-desc">${d.description || "تعلية مستقطعة"}</td>
                        <td class="col-amount">${fmtNum(amt)}</td>
                        <td class="col-status">
                            ${statusCell}
                        </td>
                        <td class="col-resp-date">${dateCell}</td>
                        <td class="col-ret-amt">${retCell}</td>
                        <td class="col-days"><span class="days-value">${days}</span> <span class="days-unit">يوم</span></td>
                    `;
        }
        tbody.appendChild(tr);
      });
    }
  });

  checkEmptyTable(tbody, 11);
  SummaryEngine.update("escalations");
  filterEscalationsByStatus();
}

function filterEscalationsByStatus() {
  const mainFilter =
    document.getElementById("escPageStatusFilter")?.value || ESC_FILTER_ALL;
  const detailFilter =
    document.getElementById("escPageStatusDetailFilter")?.value ||
    ESC_FILTER_ALL;
  const detailWrap = document.getElementById("escPageStatusDetailWrap");
  if (detailWrap)
    detailWrap.style.display =
      mainFilter === ESC_FILTER_REPLYABLE ? "" : "none";
  const query = (
    document.getElementById("searchEscalations")?.value || ""
  )
    .trim()
    .toLowerCase();

  document.querySelectorAll("#tblEscalations tbody tr").forEach((tr) => {
    if (tr.querySelector("td[colspan]")) return;
    const status = tr.getAttribute("data-filter-status");
    const statusMatches =
      mainFilter === ESC_FILTER_ALL ||
      (mainFilter === ESC_FILTER_NOT_REPLIED &&
        status === ESC_FILTER_NOT_REPLIED) ||
      (mainFilter === ESC_FILTER_REPLYABLE &&
        status !== ESC_FILTER_NOT_REPLIED &&
        (detailFilter === ESC_FILTER_ALL || status === detailFilter));
    const searchMatches = !query || tr.textContent.toLowerCase().includes(query);
    tr.style.display = statusMatches && searchMatches ? "" : "none";
  });
  SummaryEngine.update("escalations");
}

function renderReports(data) {
  renderRepExecPosition(data);
  renderRepEscalations(data);
  renderRepInvoices(data);
  populateRepEscDescFilter();
}

function renderRepExecPosition(data) {
  const tbody = document.querySelector("#tblRepExec tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let sumContract = 0;
  let sumExecWV = 0,
    sumExecVO = 0,
    sumExecMat = 0,
    sumExecClaims = 0,
    sumExecVat = 0,
    sumExecTotal = 0;
  let sumInvWV = 0,
    sumInvVO = 0,
    sumInvMat = 0,
    sumInvClaims = 0,
    sumInvVat = 0,
    sumInvTotal = 0;

  const allContracts = data.contracts || [];
  const pageContracts = paginate(allContracts, "tblRepExec");
  renderPaginationBar(
    "pagination-tblRepExec",
    allContracts.length,
    "tblRepExec",
    () => renderRepExecPosition(data),
  );

  pageContracts.forEach((c) => {
    const proj = data.projects.find((p) => p.id === c.projectId) || {};
    const owner = data.owners.find((o) => o.id === proj.ownerId) || {};

    const contractAmt = parseFloat(c.amount) || 0;
    sumContract += contractAmt;

    const positions = state.execPositions.filter((e) => e.contractId === c.id);
    positions.sort((a, b) => new Date(b.date) - new Date(a.date));
    const latestExec =
      positions.length > 0
        ? positions[0]
        : {
            workVolume: 0,
            variationOrders: 0,
            materials: 0,
            claims: 0,
            vat: 0,
          };

    const eWV = parseFloat(latestExec.workVolume) || 0;
    const eVO = parseFloat(latestExec.variationOrders) || 0;
    const eMat = parseFloat(latestExec.materials) || 0;
    const eClaims = parseFloat(latestExec.claims) || 0;
    const eVat = parseFloat(latestExec.vat) || 0;
    const eTotal = eWV + eVO + eMat + eClaims + eVat;

    sumExecWV += eWV;
    sumExecVO += eVO;
    sumExecMat += eMat;
    sumExecClaims += eClaims;
    sumExecVat += eVat;
    sumExecTotal += eTotal;

    const invoiceTotals = getContractInvoiceTotals(c.id, state.invoices);
    const iWV = invoiceTotals.workVolume;
    const iVO = invoiceTotals.variationOrders;
    const iMat = invoiceTotals.materials;
    const iClaims = invoiceTotals.claims;
    const iVat = invoiceTotals.vat;
    const iTotal = iWV + iVO + iMat + iClaims + iVat;

    sumInvWV += iWV;
    sumInvVO += iVO;
    sumInvMat += iMat;
    sumInvClaims += iClaims;
    sumInvVat += iVat;
    sumInvTotal += iTotal;

    const dWV = eWV - iWV;
    const dVO = eVO - iVO;
    const dMat = eMat - iMat;
    const dClaims = eClaims - iClaims;
    const dVat = eVat - iVat;
    const dTotal = eTotal - iTotal;

    const rateExec = contractAmt > 0 ? (eTotal / contractAmt) * 100 : 0;
    const rateInv = contractAmt > 0 ? (iTotal / contractAmt) * 100 : 0;
    const remaining = Math.max(0, contractAmt - eTotal);

    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td>${owner.name || "-"}</td>
            <td>${proj.name || "-"}</td>
            <td><strong>${c.name}</strong></td>
            <td>${fmtNum(contractAmt)}</td>
            <td>${fmtNum(eWV)}</td>
            <td>${fmtNum(eVO)}</td>
            <td>${fmtNum(eMat)}</td>
            <td>${fmtNum(eClaims)}</td>
            <td>${fmtNum(eVat)}</td>
            <td style="font-weight: 700; color: var(--primary);">${fmtNum(eTotal)}</td>
            <td>${fmtNum(iWV)}</td>
            <td>${fmtNum(iVO)}</td>
            <td>${fmtNum(iMat)}</td>
            <td>${fmtNum(iClaims)}</td>
            <td>${fmtNum(iVat)}</td>
            <td style="font-weight: 700; color: var(--success);">${fmtNum(iTotal)}</td>
         
          
            
      
            <td style="font-weight: 700;" class="${dTotal !== 0 ? (dTotal > 0 ? "diff-positive" : "diff-negative") : "diff-zero"}">${fmtNum(dTotal)}</td>
            <td>${fmtNum(rateExec, 1)}%</td>
            <td>${fmtNum(rateInv, 1)}%</td>
            <td>${fmtNum(remaining)}</td>
        `;
    tbody.appendChild(tr);
  });

  checkEmptyTable(tbody, 25);
  updateRepExecFooter();
}

function updateRepExecFooter() {
  let sumContract = 0,
    sumExecWV = 0,
    sumExecVO = 0,
    sumExecMat = 0,
    sumExecClaims = 0,
    sumExecVat = 0,
    sumExecTotal = 0;
  let sumInvWV = 0,
    sumInvVO = 0,
    sumInvMat = 0,
    sumInvClaims = 0,
    sumInvVat = 0,
    sumInvTotal = 0;
  let count = 0;

  const rows = document.querySelectorAll("#tblRepExec tbody tr");
  rows.forEach((r) => {
    if (r.style.display !== "none" && !r.querySelector("td[colspan]")) {
      count++;
      const getVal = (idx) =>
        parseFloat(r.children[idx]?.textContent.replace(/,/g, "")) || 0;
      sumContract += getVal(3);
      sumExecWV += getVal(4);
      sumExecVO += getVal(5);
      sumExecMat += getVal(6);
      sumExecClaims += getVal(7);
      sumExecVat += getVal(8);
      sumExecTotal += getVal(9);
      sumInvWV += getVal(10);
      sumInvVO += getVal(11);
      sumInvMat += getVal(12);
      sumInvClaims += getVal(13);
      sumInvVat += getVal(14);
      sumInvTotal += getVal(15);
    }
  });

  const setEl = (id, val, isPercent = false) => {
    const el = document.getElementById(id);
    if (el) el.innerText = isPercent ? fmtNum(val, 1) + "%" : fmtNum(val);
  };

  setEl("repExecFootContract", sumContract);
  setEl("repExecFootExecWV", sumExecWV);
  setEl("repExecFootExecVO", sumExecVO);
  setEl("repExecFootExecMat", sumExecMat);
  setEl("repExecFootExecClaims", sumExecClaims);
  setEl("repExecFootExecVat", sumExecVat);
  setEl("repExecFootExecTotal", sumExecTotal);
  setEl("repExecFootInvWV", sumInvWV);
  setEl("repExecFootInvVO", sumInvVO);
  setEl("repExecFootInvMat", sumInvMat);
  setEl("repExecFootInvClaims", sumInvClaims);
  setEl("repExecFootInvVat", sumInvVat);
  setEl("repExecFootInvTotal", sumInvTotal);

  setEl("repExecFootDiffWV", sumExecWV - sumInvWV);
  setEl("repExecFootDiffVO", sumExecVO - sumInvVO);
  setEl("repExecFootDiffMat", sumExecMat - sumInvMat);
  setEl("repExecFootDiffClaims", sumExecClaims - sumInvClaims);
  setEl("repExecFootDiffVat", sumExecVat - sumInvVat);
  setEl("repExecFootDiffTotal", sumExecTotal - sumInvTotal);

  setEl(
    "repExecFootRateExec",
    sumContract > 0 ? (sumExecTotal / sumContract) * 100 : 0,
    true,
  );
  setEl(
    "repExecFootRateInv",
    sumContract > 0 ? (sumInvTotal / sumContract) * 100 : 0,
    true,
  );
  setEl("repExecFootRemaining", Math.max(0, sumContract - sumExecTotal));
}

function renderRepEscalations(data) {
  const tbody = document.querySelector("#tblRepEsc tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  data.invoices.forEach((inv) => {
    if (inv.deductions && Array.isArray(inv.deductions)) {
      inv.deductions.forEach((d, idx) => {
        {
          const amt = parseFloat(d.amount) || parseFloat(d.val) || 0;
          const escKey = d.id || `${inv.id}_${idx}`;
          const isInsuranceEscalation = isSocialInsuranceDeduction(d);
          const insuranceView = isInsuranceEscalation
            ? getSocialInsuranceEscalationView(inv)
            : null;
          const resp = state.escalationsResponses[escKey] || {};
          const status = isInsuranceEscalation
            ? insuranceView.status
            : normalizeEscalationStatus(resp.responseStatus);
          const respDate = isInsuranceEscalation
            ? insuranceView.payment.paymentDate || "-"
            : resp.responseDate || "-";

          // إظهار كل تعليات التأمينات (بما فيها المسددة) عشان الفلتر يشتغل
          // Map social insurance status for report display
          let reportStatus = status;
          if (isInsuranceEscalation) {
            if (insuranceView.status === "غير مسدد")
              reportStatus = ESC_STATUS_PENDING;
            else if (insuranceView.status === "مسدد جزئياً")
              reportStatus = ESC_STATUS_PARTIAL;
          }

          let returnedAmt = 0;
          if (isInsuranceEscalation) {
            returnedAmt = insuranceView.paid;
          } else if (status === ESC_STATUS_DONE)
            returnedAmt = parseFloat(resp.returnedAmount) || amt;
          else if (status === ESC_STATUS_PARTIAL)
            returnedAmt = parseFloat(resp.returnedAmount) || amt * 0.5;

          const remainingAmt = isInsuranceEscalation
            ? insuranceView.outstanding
            : Math.max(0, amt - returnedAmt);

          const contract =
            state.contracts.find((c) => c.id === inv.contractId) || {};
          const project =
            state.projects.find((p) => p.id === contract.projectId) || {};
          const owner =
            state.owners.find((o) => o.id === project.ownerId) || {};

          const tr = document.createElement("tr");
          tr.setAttribute("data-key", escKey);
          // Unpaid SI escalations are counted like regular ones (no data-si-reference)
          tr.innerHTML = isInsuranceEscalation
            ? `
                        <td><strong>${inv.number}</strong></td>
                        <td>${owner.name || "-"}</td>
                        <td>${project.name || "-"}</td>
                        <td>${contract.name || "-"}</td>
                        <td>${fmtDisplayDate(inv.date)}</td>
                        <td>
                            <strong>تعلية تأمينات اجتماعية</strong>
                            <div style="font-size:.78rem;color:var(--gray);margin-top:.2rem;">${d.description || "تعلية تأمينات اجتماعية"}</div>
                            <div style="font-size:.75rem;color:var(--primary);margin-top:.2rem;">تعلية تأمينات اجتماعية — تتم متابعتها وسدادها من شاشة التأمينات الاجتماعية</div>
                        </td>
                        <td>${fmtNum(insuranceView.amount)}</td>
                        <td>${socialInsuranceStatusBadge(insuranceView.status)}<div style="font-size:.72rem;color:var(--gray);margin-top:.2rem;">مرجع السداد: ${insuranceView.payment.reference || "-"}</div></td>
                        <td>${fmtDisplayDate(respDate)}</td>
                        <td>${fmtNum(insuranceView.paid)}</td>
                        <td>${fmtNum(insuranceView.outstanding)}</td>
                    `
            : `
                        <td><strong>${inv.number}</strong></td>
                        <td>${owner.name || "-"}</td>
                        <td>${project.name || "-"}</td>
                        <td>${contract.name || "-"}</td>
                        <td>${fmtDisplayDate(inv.date)}</td>
                        <td>${d.description || "تعلية"}</td>
                        <td>${fmtNum(amt)}</td>
                        <td>${status}</td>
                        <td>${fmtDisplayDate(respDate)}</td>
                        <td>${fmtNum(returnedAmt)}</td>
                        <td>${fmtNum(remainingAmt)}</td>
                    `;
          if (isInsuranceEscalation) tr.style.background = "var(--light)";
          tbody.appendChild(tr);
        }
      });
    }
  });

  checkEmptyTable(tbody, 11);
  updateRepEscFooter();
}

function updateRepEscFooter() {
  let count = 0,
    sumTotal = 0,
    sumReturned = 0,
    sumRemaining = 0;
  const rows = document.querySelectorAll("#tblRepEsc tbody tr");
  rows.forEach((r) => {
    if (
      r.style.display !== "none" &&
      !r.querySelector("td[colspan]") &&
      r.getAttribute("data-si-reference") !== "true"
    ) {
      count++;
      sumTotal += parseFloat(r.children[6]?.textContent.replace(/,/g, "")) || 0;
      sumReturned +=
        parseFloat(r.children[9]?.textContent.replace(/,/g, "")) || 0;
      sumRemaining +=
        parseFloat(r.children[10]?.textContent.replace(/,/g, "")) || 0;
    }
  });

  document.getElementById("repEscFootCount").innerText = fmtNum(count, 0);
  document.getElementById("repEscFootTotal").innerText = fmtNum(sumTotal);
  document.getElementById("repEscFootReturned").innerText = fmtNum(sumReturned);
  document.getElementById("repEscFootRemaining").innerText =
    fmtNum(sumRemaining);

  const kpiCount = document.getElementById("kpiRepEscCount");
  if (kpiCount) kpiCount.innerText = fmtNum(count, 0);
  const kpiTotal = document.getElementById("kpiRepEscTotal");
  if (kpiTotal) {
    kpiTotal.innerText = fmtNumShort(sumTotal);
    kpiTotal.setAttribute("data-full", fmtNum(sumTotal));
  }
  const kpiRet = document.getElementById("kpiRepEscReturned");
  if (kpiRet) {
    kpiRet.innerText = fmtNumShort(sumReturned);
    kpiRet.setAttribute("data-full", fmtNum(sumReturned));
  }
  const kpiRem = document.getElementById("kpiRepEscRemaining");
  if (kpiRem) {
    kpiRem.innerText = fmtNumShort(sumRemaining);
    kpiRem.setAttribute("data-full", fmtNum(sumRemaining));
  }
  const kpiRate = document.getElementById("kpiRepEscRate");
  if (kpiRate)
    kpiRate.innerText =
      fmtNum(sumTotal > 0 ? (sumReturned / sumTotal) * 100 : 0, 1) + "%";
}

// Report filter functions
function populateRepEscDescFilter() {
  // Build option list from data
  const descriptions = new Set();
  let hasSocialInsurance = false;
  state.invoices.forEach((inv) => {
    if (Array.isArray(inv.deductions)) {
      inv.deductions.forEach((d) => {
        if (isSocialInsuranceDeduction(d)) {
          hasSocialInsurance = true;
          if (d.description) descriptions.add(d.description);
        } else if (d.description) {
          descriptions.add(d.description);
        }
      });
    }
  });

  const items = [];
  if (hasSocialInsurance) {
    items.push({ id: "تعلية تأمينات اجتماعية", label: "تعلية تأمينات اجتماعية" });
  }
  Array.from(descriptions)
    .sort()
    .forEach((d) => items.push({ id: d, label: d }));

  if (repFilterUI.escDesc) {
    // Update the multi-filter widget with fresh options (preserves existing selection)
    repFilterUI.escDesc.setOptions(items);
  } else {
    // Fallback: update the raw <select> if multi-filter wasn't initialised yet
    const select = document.getElementById("repEscDescFilter");
    if (!select) return;
    let html = '<option value="">الكل</option>';
    html += items
      .map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.label)}</option>`)
      .join("");
    select.innerHTML = html;
  }
}

function filterRepEscRows() {
  const query = (document.getElementById("searchRepEsc")?.value || "").toLowerCase().trim();
  // Read multi-selected values; empty array means "show all"
  const descValues = repFilterUI.escDesc ? repFilterUI.escDesc.getSelected() : [];
  const statusValues = repFilterUI.escStatus ? repFilterUI.escStatus.getSelected() : [];
  const rows = document.querySelectorAll("#tblRepEsc tbody tr");
  rows.forEach((r) => {
    if (r.querySelector("td[colspan]")) return;
    let show = true;
    if (query) {
      const text = r.textContent.toLowerCase();
      if (!text.includes(query)) show = false;
    }
    if (descValues.length > 0 && show) {
      const descCell = r.children[5]?.textContent.trim() || "";
      if (!descValues.some((v) => descCell.includes(v))) show = false;
    }
    if (statusValues.length > 0 && show) {
      const statusCell = r.children[7]?.textContent.trim() || "";
      // match if any selected status is found in the cell
      if (!statusValues.some((v) => statusCell === v || statusCell.includes(v)))
        show = false;
    }
    r.style.display = show ? "" : "none";
  });
}

function filterRepInvRows() {
  const query = (document.getElementById("searchRepInv")?.value || "").toLowerCase().trim();
  const payStatusMap = { Pending: "معلق", Paid: "مدفوع", Partial: "جزئي" };
  const lastStatusMap = { Draft: "مسودة", Review: "مراجعة", Approved: "معتمد", Rejected: "مرفوض" };
  // Read multi-selected values; empty array means "show all"
  const payValues    = repFilterUI.invPayStatus   ? repFilterUI.invPayStatus.getSelected()   : [];
  const lastValues   = repFilterUI.invLastStatus  ? repFilterUI.invLastStatus.getSelected()  : [];
  // Resolve enum IDs to Arabic display strings for matching against table cells
  const payResolved  = payValues.map((v) => payStatusMap[v] || v);
  const lastResolved = lastValues.map((v) => lastStatusMap[v] || v);
  const rows = document.querySelectorAll("#tblRepInv tbody tr");
  rows.forEach((r) => {
    if (r.querySelector("td[colspan]")) return;
    let show = true;
    if (query) {
      const text = r.textContent.toLowerCase();
      if (!text.includes(query)) show = false;
    }
    if (payResolved.length > 0 && show) {
      const payStatusCell = r.children[9]?.textContent.trim() || "";
      if (!payResolved.some((v) => payStatusCell === v || payStatusCell.includes(v)))
        show = false;
    }
    if (lastResolved.length > 0 && show) {
      const lastStatusCell = r.children[8]?.textContent.trim() || "";
      if (!lastResolved.some((v) => lastStatusCell === v || lastStatusCell.includes(v)))
        show = false;
    }
    r.style.display = show ? "" : "none";
  });
}

function renderRepInvoices(data) {
  const tbody = document.querySelector("#tblRepInv tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const todayStr = getTodayLocal();

  data.invoices.forEach((inv) => {
    const contract = state.contracts.find((c) => c.id === inv.contractId) || {};
    const project =
      state.projects.find((p) => p.id === contract.projectId) || {};
    const owner = state.owners.find((o) => o.id === project.ownerId) || {};

    const gross = getInvoiceGross(inv);
    const net = getInvoiceNet(inv);
    const terms = parseInt(contract.paymentTerms) || 45;

    let daysSinceDue = 0;
    if (inv.dueDate) {
      const d1 = new Date(inv.dueDate);
      const d2 = new Date(todayStr);
      daysSinceDue = Math.max(0, Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)));
    }

    let actualDays = 0;
    let delayDays = 0;
    if (inv.paymentDate && inv.date) {
      const d1 = new Date(inv.date);
      const d2 = new Date(inv.paymentDate);
      actualDays = Math.max(0, Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)));
      delayDays = Math.max(0, actualDays - terms);
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td><strong>${inv.number}</strong></td>
            <td>${owner.name || "-"}</td>
            <td>${project.name || "-"}</td>
            <td>${contract.name || "-"}</td>
            <td>${fmtDisplayDate(inv.date)}</td>
            <td>${fmtDisplayDate(inv.dueDate)}</td>
            <td>${terms} يوم</td>
            <td>${daysSinceDue} يوم</td>
            <td>${inv.status || "Draft"}</td>
            <td>${inv.paymentStatus || "Pending"}</td>
            <td>${fmtNum(gross)}</td>
            <td>${fmtNum(net)}</td>                            <td>${fmtDisplayDate(inv.paymentDate)}</td>
            <td>${actualDays} يوم</td>
            <td>${delayDays} يوم</td>
        `;
    tbody.appendChild(tr);
  });

  checkEmptyTable(tbody, 15);
  updateRepInvFooter();
}

function updateRepInvFooter() {
  let count = 0,
    sumGross = 0,
    sumNet = 0;
  let totalDays = 0,
    totalDelay = 0,
    paidCount = 0;
  let sumPending = 0,
    sumDueNow = 0,
    sumOverdue = 0,
    sumPaid = 0;

  const todayStr = getTodayLocal();

  const rows = document.querySelectorAll("#tblRepInv tbody tr");
  rows.forEach((r) => {
    if (r.style.display !== "none" && !r.querySelector("td[colspan]")) {
      count++;
      const gross =
        parseFloat(r.children[10]?.textContent.replace(/,/g, "")) || 0;
      const net =
        parseFloat(r.children[11]?.textContent.replace(/,/g, "")) || 0;
      sumGross += gross;
      sumNet += net;

      const payStatus = r.children[9]?.textContent.trim() || "";
      const dueDate = r.children[5]?.textContent.trim() || "";
      const actualDays = parseInt(r.children[13]?.textContent) || 0;
      const delayDays = parseInt(r.children[14]?.textContent) || 0;

      if (actualDays > 0) {
        totalDays += actualDays;
        totalDelay += delayDays;
        paidCount++;
        sumPaid += net;
      } else {
        if (dueDate && dueDate < todayStr) {
          sumOverdue += net;
        } else {
          sumPending += net;
        }
      }

      if (dueDate && dueDate <= todayStr && actualDays === 0) {
        sumDueNow += net;
      }
    }
  });

  document.getElementById("repInvFootCount").innerText = fmtNum(count, 0);
  document.getElementById("repInvFootGross").innerText = fmtNum(sumGross);
  document.getElementById("repInvFootNet").innerText = fmtNum(sumNet);
  const avgDays = paidCount > 0 ? Math.round(totalDays / paidCount) : 0;
  document.getElementById("repInvFootAvgDays").innerText = avgDays + " يوم";
  const avgDelay = paidCount > 0 ? Math.round(totalDelay / paidCount) : 0;
  document.getElementById("repInvFootAvgDelay").innerText = avgDelay + " يوم";

  const setKpi = (id, val, isCur = true) => {
    const el = document.getElementById(id);
    if (el) {
      if (isCur) {
        el.innerText = fmtNumShort(val);
        el.setAttribute("data-full", fmtNum(val));
      } else {
        el.innerText = fmtNum(val, 0);
      }
    }
  };

  setKpi("kpiRepInvCount", count, false);
  setKpi("kpiRepInvGross", sumGross);
  setKpi("kpiRepInvNet", sumNet);
  setKpi("kpiRepInvPending", sumPending);
  setKpi("kpiRepInvDueNow", sumDueNow);
  setKpi("kpiRepInvOverdue", sumOverdue);
  setKpi("kpiRepInvPaid", sumPaid);
  const elAvg = document.getElementById("kpiRepInvAvgPayDays");
  if (elAvg) elAvg.innerText = avgDays;
}

function excelDateValue(dateStr) {
  if (!dateStr) return null;
  const raw = String(dateStr).split(/[T ]/)[0];
  if (!raw || raw.length < 8) return null;
  const parts = raw.split("-");
  if (parts.length !== 3) return null;
  const d = new Date(
    parseInt(parts[0]),
    parseInt(parts[1]) - 1,
    parseInt(parts[2]),
  );
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatExcelDate(ws, cellRef, dateStr) {
  const d = excelDateValue(dateStr);
  if (!d) return;
  if (!ws[cellRef]) ws[cellRef] = {};
  ws[cellRef].v = d;
  ws[cellRef].t = "d";
  ws[cellRef].z = "DD/MM/YYYY";
}

function applyExcelFormatting(wb, sheetName, headerCount) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return;
  // Set column widths
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  const colWidths = [];
  for (let c = 0; c <= range.e.c; c++) {
    let maxWidth = 10;
    for (let r = 0; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const val = cell ? String(cell.v || "") : "";
      // Approximate width for Arabic text
      const charCount =
        val.length + (val.match(/[\u0600-\u06FF]/g) || []).length * 0.6;
      maxWidth = Math.max(maxWidth, Math.min(charCount + 2, 40));
    }
    colWidths.push({ wch: maxWidth });
  }
  ws["!cols"] = colWidths;
  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  // Auto filter
  ws["!autofilter"] = { ref: ws["!ref"] };
}

function exportTableToExcel(tableId, filename) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const wb = XLSX.utils.table_to_book(table, { sheet: "Sheet1" });
  const ws = wb.Sheets["Sheet1"];
  // Convert date-like cells (YYYY-MM-DD) to real Excel dates
  if (ws && ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 0; r <= range.e.r; r++) {
      for (let c = 0; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.t === "s") {
          const val = String(cell.v || "");
          if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            formatExcelDate(ws, addr, val);
          } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
            // Convert DD/MM/YYYY to real date
            const parts = val.split("/");
            const d = new Date(
              parseInt(parts[2]),
              parseInt(parts[1]) - 1,
              parseInt(parts[0]),
            );
            if (!isNaN(d.getTime())) {
              cell.v = d;
              cell.t = "d";
              cell.z = "DD/MM/YYYY";
            }
          }
        }
      }
    }
  }
  applyExcelFormatting(wb, "Sheet1", 1);
  XLSX.writeFile(
    wb,
    `${filename}_${new Date().toISOString().split("T")[0]}.xlsx`,
  );
}

function exportInvoiceToExcel(invoiceId) {
  if (typeof XLSX === "undefined") {
    alert("مكتبة Excel غير متاحة.");
    return;
  }
  const inv = state.invoices.find((x) => x.id === invoiceId);
  if (!inv) {
    alert("المستخلص غير موجود.");
    return;
  }

  const contract = state.contracts.find((c) => c.id === inv.contractId) || {};
  const project = state.projects.find((p) => p.id === contract.projectId) || {};
  const owner = state.owners.find((o) => o.id === project.ownerId) || {};
  const gross = getInvoiceGross(inv);
  const net = getInvoiceNet(inv);
  const positions = state.execPositions.filter(
    (e) => e.contractId === contract.id,
  );
  positions.sort((a, b) => new Date(a.date) - new Date(b.date));
  const latestExec =
    positions.length > 0 ? positions[positions.length - 1] : null;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryRows = [
    ["رقم المستخلص", inv.number || ""],
    ["التاريخ", excelDateValue(inv.date) || inv.date || ""],
    ["تاريخ الاستحقاق", excelDateValue(inv.dueDate) || inv.dueDate || ""],
    ["الحالة", inv.status || ""],
    ["حالة السداد", inv.paymentStatus || ""],
    ["المالك", owner.name || ""],
    ["المشروع", project.name || ""],
    ["العقد", contract.name || ""],
    ["قيمة العقد", parseFloat(contract.amount) || 0],
    ["", ""],
    ["حجم الأعمال", inv.workVolume || 0],
    ["أعمال إضافية (VO)", inv.variationOrders || 0],
    ["التشوينات", inv.materials || 0],
    ["التعويضات", inv.claims || 0],
    ["ضريبة القيمة المضافة", inv.vat || 0],
    ["الإجمالي (Gross)", gross],
    ["إجمالي الاستقطاعات", gross - net],
    ["الصافي النقدي", net],
    ["المبلغ المدفوع", parseFloat(inv.paidAmount) || 0],
    ["المتبقي", Math.max(0, net - (parseFloat(inv.paidAmount) || 0))],
    ["", ""],
    ["الموقف التنفيذي", ""],
    [
      "قيمة الأعمال المنفذة",
      latestExec ? parseFloat(latestExec.workVolume) || 0 : 0,
    ],
    ["قيمة VO", latestExec ? parseFloat(latestExec.variationOrders) || 0 : 0],
    ["التشوينات", latestExec ? parseFloat(latestExec.materials) || 0 : 0],
    ["التعويضات", latestExec ? parseFloat(latestExec.claims) || 0 : 0],
    ["الضريبة", latestExec ? parseFloat(latestExec.vat) || 0 : 0],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "ملخص المستخلص");

  // Sheet 2: Details/Items
  if (Array.isArray(inv.items) && inv.items.length > 0) {
    const itemRows = [["الوصف", "الكمية", "الفئة", "الإجمالي"]];
    inv.items.forEach((it) => {
      itemRows.push([
        it.description || "",
        it.qty || 0,
        it.rate || 0,
        it.currentTotal || it.total || 0,
      ]);
    });
    const wsItems = XLSX.utils.aoa_to_sheet(itemRows);
    wsItems["!cols"] = [{ wch: 35 }, { wch: 12 }, { wch: 15 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsItems, "البنود التفصيلية");
  }

  // Sheet 3: Deductions
  if (Array.isArray(inv.deductions) && inv.deductions.length > 0) {
    const dedRows = [
      ["الوصف", "النوع", "النسبة/القيمة", "المبلغ النهائي", "يرد؟"],
    ];
    inv.deductions.forEach((d) => {
      dedRows.push([
        d.description || "",
        d.calcType === "percent" ? "نسبة %" : "مبلغ ثابت",
        d.val || 0,
        d.amount || 0,
        d.isRefundable ? "نعم" : "لا",
      ]);
    });
    const wsDed = XLSX.utils.aoa_to_sheet(dedRows);
    wsDed["!cols"] = [
      { wch: 25 },
      { wch: 15 },
      { wch: 18 },
      { wch: 18 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, wsDed, "الاستقطاعات");
  }

  // Sheet 4: Status History - check all refundable deductions for this invoice
  if (Array.isArray(inv.deductions)) {
    const histRows = [["النوع", "الحالة", "التفاصيل"]];
    let hasHist = false;
    inv.deductions.forEach((ded, idx) => {
      if (!ded.isRefundable) return;
      const dedEscKey = ded.id || `${inv.id}_${idx}`;
      const escResp = state.escalationsResponses[dedEscKey];
      if (escResp) {
        histRows.push([
          "حالة التعليات",
          normalizeEscalationStatus(escResp.responseStatus),
          `تاريخ الرد: ${fmtDisplayDate(escResp.responseDate)}`,
        ]);
        hasHist = true;
      }
    });
    const siPayment = state.socialInsurance?.payments?.[inv.id];
    if (siPayment) {
      histRows.push([
        "التأمينات الاجتماعية",
        siPayment.status || "",
        `المدفوع: ${siPayment.paidAmount || 0} | تاريخ السداد: ${fmtDisplayDate(siPayment.paymentDate)}`,
      ]);
      hasHist = true;
    }
    if (hasHist) {
      const wsHist = XLSX.utils.aoa_to_sheet(histRows);
      wsHist["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, wsHist, "سجل الحالات");
    }
  }

  const dateStamp = new Date().toISOString().split("T")[0];
  const safeName = (inv.number || "invoice").replace(
    /[^\w\u0600-\u06FF-]/g,
    "_",
  );
  XLSX.writeFile(wb, `${safeName}_${dateStamp}.xlsx`);
}

function printReportSection(tabId, title) {
  const target = document.getElementById(tabId);
  const reportsView = document.getElementById("reportsView");

  if (!target || !reportsView) {
    alert("تعذر تجهيز التقرير للطباعة");
    return;
  }

  // Print only the selected report without changing its data, state, IDs, or calculations.
  document
    .querySelectorAll("#reportsView .tab-content.print-target")
    .forEach((el) => {
      el.classList.remove("print-target");
    });
  target.classList.add("print-target");

  const existingHeader = target.querySelector(":scope > .print-report-header");
  if (existingHeader) existingHeader.remove();

  const header = document.createElement("div");
  header.className = "print-report-header";

  const nameOf = (list, ids) =>
    ids.map((id) => (list.find((x) => x.id === id) || {}).name || id).join("، ");
  const activeFilters = [];
  const pf = state.filters;
  if (pf.ownerIds.length) activeFilters.push(`المالك: ${nameOf(state.owners, pf.ownerIds)}`);
  if (pf.projectIds.length) activeFilters.push(`المشروع: ${nameOf(state.projects, pf.projectIds)}`);
  if (pf.projectName) activeFilters.push(`بحث باسم المشروع: ${pf.projectName}`);
  if (pf.contractIds.length) activeFilters.push(`العقد: ${nameOf(state.contracts, pf.contractIds)}`);

  const now = new Date();
  const generatedAt = now.toLocaleString("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  header.innerHTML = `
        <h1>${title || "تقرير"}</h1>
        <div class="print-meta">
            <span>نظام إدارة المستخلصات والدفعات</span>
            <span>تاريخ الطباعة: ${generatedAt}</span>
        </div>
        ${activeFilters.length ? `<div class="print-filters"><strong>الفلاتر المطبقة:</strong> ${activeFilters.join(" &nbsp; | &nbsp; ")}</div>` : ""}
    `;

  target.insertBefore(header, target.firstChild);

  const previousTitle = document.title;
  document.title = title || previousTitle;
  document.body.classList.add("printing-report");

  const cleanup = () => {
    document.body.classList.remove("printing-report");
    target.classList.remove("print-target");
    header.remove();
    document.title = previousTitle;
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup, { once: true });

  // Let the browser apply the print stylesheet before opening the print dialog.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.print());
  });
}

/** سهم ترتيب عمود التاريخ في جدول المستخلصات (أحدث↔أقدم). */
function initInvoiceDateSortHeader() {
  const table = document.getElementById("tblInvoices");
  if (!table) return;
  const thead = table.querySelector("thead");
  if (!thead) return;

  // ابحث عن خلية رأس «التاريخ» (عمود تاريخ المستخلص وليس تاريخ الاستحقاق)
  const ths = Array.from(thead.querySelectorAll("th"));
  let dateTh = ths.find((th) => {
    const t = (th.textContent || "").replace(/\s+/g, " ").trim();
    return t === "التاريخ" || t.startsWith("التاريخ");
  });
  if (!dateTh) return;
  if (dateTh.dataset.sortBound === "1") {
    updateInvoiceDateSortIndicator(dateTh);
    return;
  }
  dateTh.dataset.sortBound = "1";
  dateTh.style.cursor = "pointer";
  dateTh.style.userSelect = "none";
  dateTh.title = "ترتيب حسب التاريخ";

  // حافظ على نص العنوان + أضف السهم
  const label =
    (dateTh.textContent || "التاريخ").replace(/[▲▼↕]/g, "").trim() || "التاريخ";
  dateTh.innerHTML = `<span class="th-sort-label">${label}</span> <span class="th-sort-arrow" aria-hidden="true">↕</span>`;
  updateInvoiceDateSortIndicator(dateTh);

  dateTh.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window._invDateSortDir = window._invDateSortDir === "asc" ? "desc" : "asc";
    updateInvoiceDateSortIndicator(dateTh);
    // أعد رسم الجدول بالترتيب الجديد (مع الفلاتر الحالية)
    if (typeof filteredData !== "undefined" && filteredData) {
      renderInvoices(filteredData);
    } else {
      renderInvoices(state);
    }
    if (typeof SummaryEngine !== "undefined") SummaryEngine.update("invoices");
  });
}

function updateInvoiceDateSortIndicator(th) {
  if (!th) return;
  const arrow = th.querySelector(".th-sort-arrow");
  if (!arrow) return;
  const dir = window._invDateSortDir === "asc" ? "asc" : "desc";
  // desc = الأحدث أولاً → السهم لأسفل، asc = الأقدم أولاً → لأعلى
  arrow.textContent = dir === "desc" ? "▼" : "▲";
  th.title =
    dir === "desc"
      ? "مرتّب: الأحدث أولاً — اضغط للأقدم أولاً"
      : "مرتّب: الأقدم أولاً — اضغط للأحدث أولاً";
  th.setAttribute("data-sort-dir", dir);
}

function sortTable(tableId, colIndex) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr")).filter(
    (r) => !r.querySelector("td[colspan]"),
  );

  const isNumeric = rows.every(
    (r) =>
      !isNaN(parseFloat(r.children[colIndex]?.textContent.replace(/,/g, ""))),
  );

  rows.sort((a, b) => {
    const valA = a.children[colIndex]?.textContent.trim() || "";
    const valB = b.children[colIndex]?.textContent.trim() || "";

    if (isNumeric) {
      return (
        parseFloat(valA.replace(/,/g, "")) - parseFloat(valB.replace(/,/g, ""))
      );
    }
    return valA.localeCompare(valB, "ar");
  });

  tbody.innerHTML = "";
  rows.forEach((r) => tbody.appendChild(r));
}

function openOwnerModal(id = null) {
  // Permission: create when opening empty form; edit when opening with id is handled by edit*
  if (!arguments[0] && !assertCan("owners", "create", "إضافة مالك")) return;
  document.getElementById("ownerId").value = "";
  document.getElementById("ownerName").value = "";
  document.getElementById("ownerPhone").value = "";
  document.getElementById("ownerEmail").value = "";
  document.getElementById("lblOwnerModal").innerText = "إضافة مالك جديد";
  document.getElementById("modalOwner").classList.add("active");
}

function editOwner(id) {
  if (!assertCan("owners", "edit", "تعديل المالك")) return;
  const o = state.owners.find((x) => x.id === id);
  if (!o) return;
  document.getElementById("ownerId").value = o.id;
  document.getElementById("ownerName").value = o.name || "";
  document.getElementById("ownerPhone").value = o.phone || "";
  document.getElementById("ownerEmail").value = o.email || "";
  document.getElementById("lblOwnerModal").innerText = "تعديل بيانات المالك";
  document.getElementById("modalOwner").classList.add("active");
}

async function saveOwner() {
  if (
    !assertCan(
      "owners",
      document.getElementById("ownerId")?.value ? "edit" : "create",
      "حفظ المالك",
    )
  )
    return;
  const id = document.getElementById("ownerId").value;
  const name = document.getElementById("ownerName").value.trim();
  if (!name) {
    alert("يرجى إدخال اسم المالك");
    return;
  }

  const phone = document.getElementById("ownerPhone").value.trim();
  const email = document.getElementById("ownerEmail").value.trim();

  const dto = {
    id: id || null,
    name,
    phone: phone || null,
    email: email || null,
  };

  try {
    if (id) {
      await erpApi.owners.update(id, dto);
    } else {
      await erpApi.owners.create(dto);
    }
    await syncStateFromBackend();
  } catch (error) {
    console.error("Save owner failed:", error);
    alert("حدث خطأ أثناء حفظ المالك: " + (error.message || ""));
    return;
  }

  document.getElementById("modalOwner").classList.remove("active");
  populateDropdowns();
  applyGlobalFilters();
}

async function deleteOwner(id) {
  if (!assertCan("owners", "delete", "حذف المالك")) return;
  if (
    !(await erpNotify.showConfirm(
      "هل أنت متأكد من حذف هذا المالك؟ سيتم حذف المشروعات والعقود المرتبطة.",
      { title: "تأكيد حذف المالك", confirmText: "حذف", cancelText: "إلغاء" },
    ))
  )
    return;
  try {
    await erpApi.owners.remove(id);
    await syncStateFromBackend();
    populateDropdowns();
    applyGlobalFilters();
  } catch (error) {
    console.error("Delete owner failed:", error);
    alert("حدث خطأ أثناء حذف المالك: " + (error.message || ""));
  }
}

/* ---- Sector Manager Combobox ---- */
let _smInitialized = false;

function setSectorManagerCombobox(managerId) {
  const hiddenInput = document.getElementById("projectSectorManagerId");
  const searchInput = document.getElementById("projectSectorManagerSearch");
  if (!hiddenInput || !searchInput) return;
  if (!managerId) {
    hiddenInput.value = "";
    searchInput.value = "";
    return;
  }
  const mgr = state.sectorManagers.find((m) => m.id === managerId);
  hiddenInput.value = managerId;
  searchInput.value = mgr ? mgr.displayName : managerId;
}

function closeSectorManagerDropdown() {
  const dropdown = document.getElementById("projectSectorManagerDropdown");
  if (dropdown) dropdown.style.display = "none";
}

function initSectorManagerCombobox() {
  const searchInput = document.getElementById("projectSectorManagerSearch");
  const hiddenInput = document.getElementById("projectSectorManagerId");
  const dropdown = document.getElementById("projectSectorManagerDropdown");
  if (!searchInput || !hiddenInput || !dropdown) return;

  // Remove previous listeners by cloning
  const newInput = searchInput.cloneNode(true);
  searchInput.parentNode.replaceChild(newInput, searchInput);
  _smInitialized = false;

  async function renderDropdown(query) {
    if (!state.sectorManagers || !state.sectorManagers.length) {
      await loadSectorManagers();
    }
    dropdown.innerHTML = "";
    const q = (query || "").trim().toLowerCase();
    const managers = state.sectorManagers || [];
    let results = managers;

    if (q) {
      // If query matches current manager exactly, still show full list for easy re-selection
      const currentMgr = hiddenInput.value ? managers.find((m) => m.id === hiddenInput.value) : null;
      if (!currentMgr || currentMgr.displayName.toLowerCase() !== q) {
        results = managers.filter(
          (m) =>
            m.displayName.toLowerCase().includes(q) ||
            (m.username && m.username.toLowerCase().includes(q)),
        );
      }
    }

    if (hiddenInput.value) {
      const clearItem = document.createElement("div");
      clearItem.className = "sm-item sm-clear";
      clearItem.textContent = "✕ مسح الاختيار";
      clearItem.addEventListener("mousedown", (e) => {
        e.preventDefault();
        hiddenInput.value = "";
        document.getElementById("projectSectorManagerSearch").value = "";
        dropdown.style.display = "none";
      });
      dropdown.appendChild(clearItem);
    }

    if (!results.length) {
      const noRes = document.createElement("div");
      noRes.className = "sm-no-results";
      noRes.textContent = "لا توجد نتائج";
      dropdown.appendChild(noRes);
    } else {
      results.forEach((mgr) => {
        const item = document.createElement("div");
        item.className = "sm-item";
        if (mgr.id === hiddenInput.value) item.classList.add("active");
        item.textContent = mgr.displayName;
        if (mgr.username && mgr.username !== mgr.displayName) {
          item.textContent += ` (${mgr.username})`;
        }
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          hiddenInput.value = mgr.id;
          document.getElementById("projectSectorManagerSearch").value =
            mgr.displayName;
          dropdown.style.display = "none";
        });
        dropdown.appendChild(item);
      });
    }

    dropdown.style.display = "block";
  }

  newInput.addEventListener("focus", () => {
    newInput.select();
    renderDropdown(newInput.value);
  });
  newInput.addEventListener("input", () => renderDropdown(newInput.value));
  newInput.addEventListener("blur", () => {
    setTimeout(() => {
      dropdown.style.display = "none";
      if (!newInput.value.trim()) hiddenInput.value = "";
    }, 180);
  });
}

function openProjectModal() {
  // Permission: create when opening empty form; edit when opening with id is handled by edit*
  if (!assertCan("projects", "create", "إضافة مشروع")) return;
  document.getElementById("projectId").value = "";
  document.getElementById("projectOwnerId").value = "";
  document.getElementById("projectName").value = "";
  setInputDate("projectStartDate", getTodayLocal());
  document.getElementById("projectStatus").value = "Active";
  setSectorManagerCombobox(null);
  document.getElementById("lblProjectModal").innerText = "إضافة مشروع جديد";
  document.getElementById("modalProject").classList.add("active");
  initFlatpickr();
  initSectorManagerCombobox();
}

function editProject(id) {
  if (!assertCan("projects", "edit", "تعديل المشروع")) return;
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  document.getElementById("projectId").value = p.id;
  document.getElementById("projectOwnerId").value = p.ownerId;
  document.getElementById("projectName").value = p.name || "";
  setInputDate("projectStartDate", p.startDate);
  document.getElementById("projectStatus").value = p.status || "Active";
  setSectorManagerCombobox(p.sectorManagerId || null);
  document.getElementById("lblProjectModal").innerText = "تعديل بيانات المشروع";
  document.getElementById("modalProject").classList.add("active");
  initFlatpickr();
  initSectorManagerCombobox();
}

async function saveProject() {
  if (
    !assertCan(
      "projects",
      document.getElementById("projectId")?.value ? "edit" : "create",
      "حفظ المشروع",
    )
  )
    return;
  const id = document.getElementById("projectId").value;
  const ownerId = document.getElementById("projectOwnerId").value;
  const name = document.getElementById("projectName").value.trim();
  const startDate = document.getElementById("projectStartDate").value;
  const status = document.getElementById("projectStatus").value;
  const sectorManagerId = document.getElementById("projectSectorManagerId")?.value || null;

  if (!ownerId || !name) {
    alert("يرجى استكمال الحقول المطلوبة");
    return;
  }

  const dto = {
    id: id || null,
    ownerId,
    name,
    startDate: startDate || null,
    status: status || "Active",
    sectorManagerId: sectorManagerId || null,
  };

  try {
    if (id) {
      await erpApi.projects.update(id, dto);
    } else {
      await erpApi.projects.create(dto);
    }
    await syncStateFromBackend();
  } catch (error) {
    console.error("Save project failed:", error);
    alert("حدث خطأ أثناء حفظ المشروع: " + (error.message || ""));
    return;
  }

  document.getElementById("modalProject").classList.remove("active");
  closeSectorManagerDropdown();
  populateDropdowns();
  applyGlobalFilters();
}

async function deleteProject(id) {
  if (!assertCan("projects", "delete", "حذف المشروع")) return;
  if (
    !(await erpNotify.showConfirm("هل أنت متأكد من حذف هذا المشروع؟", {
      title: "تأكيد الحذف",
      confirmText: "حذف",
      cancelText: "إلغاء",
    }))
  )
    return;
  try {
    await erpApi.projects.remove(id);
    await syncStateFromBackend();
    populateDropdowns();
    applyGlobalFilters();
  } catch (error) {
    console.error("Delete project failed:", error);
    alert("حدث خطأ أثناء حذف المشروع: " + (error.message || ""));
  }
}

function openContractModal() {
  // Permission: create when opening empty form; edit when opening with id is handled by edit*
  if (!assertCan("contracts", "create", "إضافة عقد")) return;
  document.getElementById("contractId").value = "";
  document.getElementById("contractProjectId").value = "";
  document.getElementById("contractName").value = "";
  document.getElementById("contractAmount").value = "";
  document.getElementById("contractModifiedAmount").value = "";
  document.getElementById("contractVoAmount").value = "0";
  document.getElementById("contractClaimsAmount").value = "0";
  document.getElementById("contractVatAmount").value = "0";
  document.getElementById("contractPaymentTerms").value = "30";
  setInputDate("contractSignDate", getTodayLocal());
  const contractDurationEl = document.getElementById("contractDuration");
  if (contractDurationEl) contractDurationEl.value = "";
  const contractEndDateEl =
    document.getElementById("contractEndDate") ||
    document.getElementById("EndDate");
  if (contractEndDateEl) contractEndDateEl.value = "";
  document.getElementById("contractStatus").value = "Active";
  document.getElementById("lblContractModal").innerText = "إضافة عقد جديد";
  document.getElementById("modalContract").classList.add("active");
  initFlatpickr();
}

function editContract(id) {
  if (!assertCan("contracts", "edit", "تعديل العقد")) return;
  const c = state.contracts.find((x) => x.id === id);
  if (!c) return;
  document.getElementById("contractId").value = c.id;
  document.getElementById("contractProjectId").value = c.projectId;
  document.getElementById("contractName").value = c.name || "";
  document.getElementById("contractAmount").value = c.amount || 0;
  document.getElementById("contractModifiedAmount").value =
    c.modifiedAmount ?? 0;
  document.getElementById("contractVoAmount").value = c.voAmount ?? 0;
  document.getElementById("contractClaimsAmount").value = c.claimsAmount ?? 0;
  document.getElementById("contractVatAmount").value = c.vatAmount ?? 0;
  document.getElementById("contractPaymentTerms").value = c.paymentTerms || 45;
  setInputDate("contractSignDate", c.signDate);
  const contractDurationEl = document.getElementById("contractDuration");
  if (contractDurationEl)
    contractDurationEl.value =
      c.contractDuration !== undefined && c.contractDuration !== null
        ? c.contractDuration
        : "";
  const contractEndDateEl =
    document.getElementById("contractEndDate") ||
    document.getElementById("EndDate");
  if (contractEndDateEl) {
    contractEndDateEl.value = c.endDate ? fmtDisplayDate(c.endDate) : "-";
  }
  document.getElementById("contractStatus").value = c.status || "Active";
  document.getElementById("lblContractModal").innerText = "تعديل بيانات العقد";
  document.getElementById("modalContract").classList.add("active");
  initFlatpickr();
}

async function saveContract() {
  if (
    !assertCan(
      "contracts",
      document.getElementById("contractId")?.value ? "edit" : "create",
      "حفظ العقد",
    )
  )
    return;
  const id = document.getElementById("contractId").value;
  const projectId = document.getElementById("contractProjectId").value;
  const name = document.getElementById("contractName").value.trim();
  const amount =
    parseFloat(document.getElementById("contractAmount").value) || 0;
  const modifiedRaw = document.getElementById("contractModifiedAmount").value;
  const modifiedAmount =
    modifiedRaw === "" || modifiedRaw === null ? 0 : parseFloat(modifiedRaw);
  if (Number.isNaN(modifiedAmount) || modifiedAmount < 0) {
    alert("قيمة العقد المعدل يجب أن تكون رقماً صالحاً (أكبر من أو يساوي صفر).");
    return;
  }
  const paymentTerms =
    parseInt(document.getElementById("contractPaymentTerms").value) || 45;
  const signDate = document.getElementById("contractSignDate").value;
  const durationRaw = document.getElementById("contractDuration")
    ? document.getElementById("contractDuration").value.trim()
    : "";
  const contractDuration =
    durationRaw === "" ? 0 : parseInt(durationRaw, 10);
  if (Number.isNaN(contractDuration) || contractDuration < 0) {
    alert("مدة التعاقد يجب أن تكون رقماً صالحاً (أكبر من أو يساوي صفر).");
    return;
  }
  const status = document.getElementById("contractStatus").value;

  if (!projectId || !name || amount <= 0) {
    alert("يرجى استكمال الحقول المطلوبة بشكل صحيح");
    return;
  }

  // VO / Claims / Vat are read-only in UI; backend keeps them in sync from exec position.
  // On create they start at 0; on update we send current stored values without allowing manual override of dynamics.
  const dto = {
    id: id || null,
    projectId,
    name,
    amount,
    modifiedAmount,
    voAmount: id
      ? parseFloat(document.getElementById("contractVoAmount").value) || 0
      : 0,
    claimsAmount: id
      ? parseFloat(document.getElementById("contractClaimsAmount").value) || 0
      : 0,
    vatAmount: id
      ? parseFloat(document.getElementById("contractVatAmount").value) || 0
      : 0,
    paymentTerms,
    signDate: signDate || null,
    contractDuration,
    status: status || "Active",
  };

  try {
    let savedContract = null;
    if (id) {
      savedContract = await erpApi.contracts.update(id, dto);
    } else {
      savedContract = await erpApi.contracts.create(dto);
    }
    await syncStateFromBackend();
    const contractEndDateEl =
      document.getElementById("contractEndDate") ||
      document.getElementById("EndDate");
    if (contractEndDateEl) {
      const currentContract = state.contracts.find(
        (x) => x.id === (id || savedContract?.id),
      );
      if (currentContract?.endDate) {
        contractEndDateEl.value = fmtDisplayDate(currentContract.endDate);
      } else if (savedContract?.endDate) {
        contractEndDateEl.value = fmtDisplayDate(savedContract.endDate);
      }
    }
  } catch (error) {
    console.error("Save contract failed:", error);
    alert("حدث خطأ أثناء حفظ العقد: " + (error.message || ""));
    return;
  }

  document.getElementById("modalContract").classList.remove("active");
  populateDropdowns();
  applyGlobalFilters();
}

async function deleteContract(id) {
  if (!assertCan("contracts", "delete", "حذف العقد")) return;
  if (
    !(await erpNotify.showConfirm("هل أنت متأكد من حذف هذا العقد؟", {
      title: "تأكيد الحذف",
      confirmText: "حذف",
      cancelText: "إلغاء",
    }))
  )
    return;
  try {
    await erpApi.contracts.remove(id);
    await syncStateFromBackend();
    populateDropdowns();
    applyGlobalFilters();
  } catch (error) {
    console.error("Delete contract failed:", error);
    alert("حدث خطأ أثناء حذف العقد: " + (error.message || ""));
  }
}

function openInvoiceModal(invoiceId = null) {
  // Permission: create when opening empty form; edit when opening with id is handled by edit*
  if (!assertCan("invoices", "create", "إضافة مستخلص")) return;
  document.getElementById("invoiceId").value = "";
  document.getElementById("invOwnerId").value = "";
  document.getElementById("invProjectId").value = "";
  document.getElementById("invContractId").value = "";
  document.getElementById("invNumber").value =
    "مستخلص-" + (state.invoices.length + 1);
  document.getElementById("invDate").value = "";
  document.getElementById("invDueDate").value = "";
  document.getElementById("invStatus").value = "Approved";
  document.getElementById("invPaymentStatus").value = "Pending";
  document.getElementById("invPaidAmount").value = "0";
  document.getElementById("invPaymentDate").value = "";

  document.querySelectorAll(".inv-cum-val").forEach((i) => (i.value = "0"));
  document.querySelectorAll(".inv-prev-val").forEach((i) => (i.value = "0"));
  document.querySelectorAll(".inv-curr-val").forEach((i) => (i.value = "0"));

  document.querySelector("#tblInvItems tbody").innerHTML = "";
  const dedContainer = document.getElementById("deductionCardsContainer");
  if (dedContainer) dedContainer.innerHTML = "";

  if (invoiceId) {
    const inv = state.invoices.find((x) => x.id === invoiceId);
    if (inv) {
      document.getElementById("invoiceId").value = inv.id;
      // Resolve owner/project from the invoice's contract, since
      // InvoiceDto does not carry ownerId or projectId directly.
      const invContract =
        state.contracts.find((c) => c.id === inv.contractId) || {};
      const invProject =
        state.projects.find((p) => p.id === invContract.projectId) || {};
      const invOwnerId = inv.ownerId || invProject.ownerId || "";
      const invProjectId = inv.projectId || invContract.projectId || "";
      document.getElementById("invOwnerId").value = invOwnerId;
      populateModalProjects(invOwnerId);
      document.getElementById("invProjectId").value = invProjectId;
      populateModalContracts(invProjectId);
      document.getElementById("invContractId").value = inv.contractId || "";
      document.getElementById("invNumber").value = inv.number || "";
      setInputDate("invDate", inv.date);
      setInputDate("invDueDate", inv.dueDate);
      document.getElementById("invStatus").value = inv.status || "Approved";
      document.getElementById("invPaymentStatus").value =
        inv.paymentStatus || "Pending";
      document.getElementById("invPaidAmount").value = inv.paidAmount || 0;
      setInputDate("invPaymentDate", inv.paymentDate);

      ["workVolume", "variationOrders", "materials", "claims", "vat"].forEach(
        (k) => {
          const el = document.getElementById(
            "inv" + k.charAt(0).toUpperCase() + k.slice(1),
          );
          if (el) el.value = inv[k] || 0;
        },
      );

      if (inv.items && Array.isArray(inv.items)) {
        inv.items.forEach((it) => addInvItemRow(it));
      }
      if (inv.deductions && Array.isArray(inv.deductions)) {
        inv.deductions.forEach((d) => addInvDeductionRow(d));
      }

      // IMPORTANT: when reopening an existing invoice, restore Previous/Current
      // from the same authoritative history engine used at save time.
      // This prevents the form from showing the whole Cumulative value as Current.
      loadPreviousInvoiceValues();
    }
  } else {
    // New invoice: all dropdowns start empty — user must select owner first.
    document.getElementById("invOwnerId").value = "";
    document.getElementById("invProjectId").innerHTML =
      '<option value="">اختر المشروع...</option>';
    document.getElementById("invContractId").innerHTML =
      '<option value="">اختر العقد...</option>';
    updateInvoiceDueDate();
    loadPreviousInvoiceValues();
  }

  calcInvoiceTotals();
  document.getElementById("lblInvoiceModal").innerText = invoiceId
    ? "تعديل المستخلص"
    : "مستخلص جديد";
  document.getElementById("modalInvoice").classList.add("active");
  // Ensure all _curr fields are recalculated after modal is visible
  requestAnimationFrame(() => calcInvoiceTotals());
  // Ensure ALL cumulative inputs have listeners (including VAT)
  [
    "invWorkVolume",
    "invVariationOrders",
    "invMaterials",
    "invClaims",
    "invVat",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener("input", calcInvoiceTotals);
      el.addEventListener("input", calcInvoiceTotals);
    }
  });
  // Activate flatpickr on newly visible date inputs
  initFlatpickr();
}

function loadPreviousInvoiceValues() {
  const contractId = document.getElementById("invContractId").value;
  const currentInvoiceId = document.getElementById("invoiceId").value;
  const currentDate = document.getElementById("invDate").value;

  if (!contractId) return;

  // Use the exact same ordering used by recalculateInvoiceHistory():
  // date -> createdAt -> id. The current invoice is excluded explicitly.
  // This keeps the form calculation and the saved calculation identical.
  const contractInvoices = getOrderedContractInvoices(
    contractId,
    state.invoices,
  ).filter((x) => x.invoice.id !== currentInvoiceId);

  let latestPrevInv = null;
  if (contractInvoices.length) {
    const currentCreatedAt = currentInvoiceId
      ? state.invoices.find((i) => i.id === currentInvoiceId)?.createdAt || ""
      : new Date().toISOString();

    const currentKey = {
      date: String(currentDate || ""),
      createdAt: String(currentCreatedAt || ""),
      id: String(currentInvoiceId || "ZZZZZZZZ"),
    };

    const isBeforeCurrent = (candidate) => {
      const c = candidate.invoice;
      const dateDiff = String(c.date || "").localeCompare(currentKey.date);
      if (dateDiff !== 0) return dateDiff < 0;

      const createdDiff = String(c.createdAt || "").localeCompare(
        currentKey.createdAt,
      );
      if (createdDiff !== 0) return createdDiff < 0;

      return String(c.id || "").localeCompare(currentKey.id) < 0;
    };

    const preceding = contractInvoices.filter(isBeforeCurrent);
    latestPrevInv = preceding.length
      ? preceding[preceding.length - 1].invoice
      : null;
  }
  const previousComps = getInvoiceCumulativeComponents(latestPrevInv);
  const keys = ["workVolume", "variationOrders", "materials", "claims", "vat"];

  keys.forEach((k) => {
    const capKey = k.charAt(0).toUpperCase() + k.slice(1);
    const prevInput = document.getElementById(`inv${capKey}_prev`);
    const cumInput = document.getElementById(`inv${capKey}`);
    const prevVal = previousComps[k] || 0;

    if (prevInput) prevInput.value = prevVal;
    if (
      cumInput &&
      !currentInvoiceId &&
      prevVal > 0 &&
      (parseFloat(cumInput.value) || 0) === 0
    ) {
      cumInput.value = prevVal;
    }
  });

  calcInvoiceTotals();
}

function calculateInvoiceHistoryValues(invoice, orderedInvoices) {
  const index = orderedInvoices.findIndex((x) => x.invoice.id === invoice.id);
  const cumulative = getInvoiceCumulativeComponents(invoice);
  const previous =
    index > 0
      ? getInvoiceCumulativeComponents(orderedInvoices[index - 1].invoice)
      : {
          workVolume: 0,
          variationOrders: 0,
          materials: 0,
          claims: 0,
          vat: 0,
        };

  return {
    previousValues: { ...previous },
    currentValues: {
      workVolume: cumulative.workVolume - previous.workVolume,
      variationOrders: cumulative.variationOrders - previous.variationOrders,
      materials: cumulative.materials - previous.materials,
      claims: cumulative.claims - previous.claims,
      vat: cumulative.vat - previous.vat,
    },
    cumulativeValues: { ...cumulative },
  };
}

function recalculateInvoiceHistory(contractId) {
  if (!contractId) return;
  const ordered = getOrderedContractInvoices(contractId, state.invoices);

  ordered.forEach(({ invoice }) => {
    const values = calculateInvoiceHistoryValues(invoice, ordered);
    invoice.previousValues = values.previousValues;
    invoice.currentValues = values.currentValues;
    invoice.cumulativeValues = values.cumulativeValues;
  });
}

function calcInvoiceTotals() {
  const keys = ["workVolume", "variationOrders", "materials", "claims", "vat"];
  const currentComps = {};

  keys.forEach((k) => {
    const capKey = k.charAt(0).toUpperCase() + k.slice(1);
    const cumInput = document.getElementById(`inv${capKey}`);
    const prevInput = document.getElementById(`inv${capKey}_prev`);
    const currInput = document.getElementById(`inv${capKey}_curr`);

    const cum = parseFloat(cumInput?.value) || 0;
    const prev = parseFloat(prevInput?.value) || 0;
    const curr = cum - prev;

    if (currInput) currInput.value = curr;
    currentComps[k] = curr;
  });

  let itemsTotal = 0;
  document.querySelectorAll("#tblInvItems tbody tr").forEach((tr) => {
    const qty = parseFloat(tr.querySelector(".item-qty")?.value) || 0;
    const rate = parseFloat(tr.querySelector(".item-rate")?.value) || 0;
    const tot = qty * rate;
    const totEl = tr.querySelector(".item-total");
    if (totEl) totEl.innerText = fmtNum(tot);
    itemsTotal += tot;
  });

  const compTotal = Object.values(currentComps).reduce((a, b) => a + b, 0);
  let gross = itemsTotal + compTotal;

  const lblItemsTotal = document.getElementById("lblItemsTotal");
  if (lblItemsTotal) lblItemsTotal.innerText = fmtNum(gross);

  let totalDeductions = 0;
  document
    .querySelectorAll("#deductionCardsContainer .deduction-card")
    .forEach((card) => {
      const type = card.querySelector(".ded-type")?.value;
      const selKeys = resolveDeductionSelectedKeys({
        calcFromKeys:
          card
            .querySelector(".ms-btn")
            ?.getAttribute("data-selected")
            ?.split(",") || [],
      });
      const val = parseFloat(card.querySelector(".ded-val")?.value) || 0;

      const base = getCalculationBase(selKeys, {
        currentComponents: currentComps,
      });
      let amt = 0;
      if (type === "percent") {
        amt = base * (val / 100);
      } else {
        amt = val;
      }

      const amtEl = card.querySelector(".ded-amount");
      if (amtEl) amtEl.innerText = fmtNum(amt);
      totalDeductions += amt;
    });

  const lblDeductionsTotal = document.getElementById("lblDeductionsTotal");
  if (lblDeductionsTotal)
    lblDeductionsTotal.innerText = fmtNum(totalDeductions);

  const net = Math.max(0, gross - totalDeductions);
  const lblNetTotal = document.getElementById("lblNetTotal");
  if (lblNetTotal) lblNetTotal.innerText = fmtNum(net);

  // Show/hide empty state
  const container = document.getElementById("deductionCardsContainer");
  const emptyState = document.getElementById("deductionEmptyState");
  if (container && emptyState) {
    const hasCards = container.querySelectorAll(".deduction-card").length > 0;
    emptyState.style.display = hasCards ? "none" : "flex";
  }
}

function addInvItemRow(data = null) {
  const tbody = document.querySelector("#tblInvItems tbody");
  if (!tbody) return;
  const isNew = !data || (!data.description && !data.qty && !data.rate);
  const tr = document.createElement("tr");
  tr.innerHTML = `
        <td><input type="text" class="form-control item-desc" placeholder="وصف البند" value="${data ? data.description || "" : ""}"></td>
        <td><input type="number" step="any" class="form-control item-qty" placeholder="0" value="${data ? data.qty || 0 : 0}"></td>
        <td><input type="number" step="any" class="form-control item-rate" placeholder="0" value="${data ? data.rate || 0 : 0}"></td>
        <td class="item-total" style="font-weight: 700;">0.00</td>
        <td class="item-actions">
            <button type="button" class="btn btn-success btn-sm item-save-btn" title="حفظ البند">💾 حفظ</button>
            <button type="button" class="btn-icon btn-icon-delete item-delete-btn" title="حذف البند">${ICON_BTN_DELETE}</button>
        </td>
    `;
  tbody.appendChild(tr);

  // Bind input events for live total calculation
  tr.querySelectorAll("input").forEach((inp) =>
    inp.addEventListener("input", calcInvoiceTotals),
  );

  // Save button: validate and confirm the item is saved
  const saveBtn = tr.querySelector(".item-save-btn");
  const deleteBtn = tr.querySelector(".item-delete-btn");

  deleteBtn.addEventListener("click", () => {
    tr.remove();
    calcInvoiceTotals();
    refreshDeductionMultiSelects();
  });

  saveBtn.addEventListener("click", () => {
    const desc = tr.querySelector(".item-desc")?.value.trim();
    const qty = parseFloat(tr.querySelector(".item-qty")?.value) || 0;
    const rate = parseFloat(tr.querySelector(".item-rate")?.value) || 0;

    if (!desc && qty === 0 && rate === 0) {
      alert("يرجى إدخال بيانات البند على الأقل (الوصف أو الكمية والفئة).");
      return;
    }

    // Mark as saved visually
    tr.classList.add("item-saved");
    saveBtn.textContent = "✅ تم الحفظ";
    saveBtn.disabled = true;
    saveBtn.classList.remove("btn-success");
    saveBtn.classList.add("btn-secondary");

    // Disable inputs after save to prevent accidental edits
    tr.querySelectorAll("input").forEach((inp) => {
      inp.readOnly = true;
      inp.style.opacity = "0.8";
    });

    // Allow re-editing by clicking on row
    tr.addEventListener("dblclick", () => {
      tr.classList.remove("item-saved");
      saveBtn.textContent = "💾 حفظ";
      saveBtn.disabled = false;
      saveBtn.classList.remove("btn-secondary");
      saveBtn.classList.add("btn-success");
      tr.querySelectorAll("input").forEach((inp) => {
        inp.readOnly = false;
        inp.style.opacity = "1";
      });
    });

    calcInvoiceTotals();
    refreshDeductionMultiSelects();
  });

  // For loaded data (from DB), auto-save visually
  if (!isNew) {
    tr.classList.add("item-saved");
    saveBtn.textContent = "✅ تم الحفظ";
    saveBtn.disabled = true;
    saveBtn.classList.remove("btn-success");
    saveBtn.classList.add("btn-secondary");
    tr.querySelectorAll("input").forEach((inp) => {
      inp.readOnly = true;
      inp.style.opacity = "0.8";
    });
    tr.addEventListener("dblclick", () => {
      tr.classList.remove("item-saved");
      saveBtn.textContent = "💾 حفظ";
      saveBtn.disabled = false;
      saveBtn.classList.remove("btn-secondary");
      saveBtn.classList.add("btn-success");
      tr.querySelectorAll("input").forEach((inp) => {
        inp.readOnly = false;
        inp.style.opacity = "1";
      });
    });
  }

  calcInvoiceTotals();
}

function getDeductionLibrary() {
  return Array.isArray(state.deductionLibrary) ? state.deductionLibrary : [];
}

function saveDeductionLibrary(list) {
  state.deductionLibrary = Array.isArray(list) ? list : [];
  saveLocalStorage();
}

function ensureDeductionLibraryInitialized() {
  if (!Array.isArray(state.deductionLibrary)) state.deductionLibrary = [];
  return state.deductionLibrary;
}

function getDeductionLibraryOptions(data) {
  const library = ensureDeductionLibraryInitialized();
  const currentName = (data?.description || "").trim();
  let selectedId = data?.libraryId || "";
  if (!selectedId && currentName) {
    const found = library.find((x) => x.name.trim() === currentName);
    if (found) selectedId = found.id;
  }
  if (currentName && !library.some((x) => x.id === selectedId)) {
    const legacy = { id: generateId(12), name: currentName };
    library.push(legacy);
    saveDeductionLibrary(library);
    selectedId = legacy.id;
  }
  return { library, selectedId };
}

function confirmDeleteDeductionCard(card) {
  if (!card) return;
  const overlay = document.createElement("div");
  overlay.className = "deduction-confirm-overlay";
  overlay.innerHTML = `
        <div class="deduction-confirm-dialog">
            <div class="confirm-icon">⚠️</div>
            <div class="confirm-message">هل أنت متأكد من حذف هذا الاستقطاع؟</div>
            <div class="confirm-actions">
                <button type="button" class="btn btn-secondary confirm-cancel">إلغاء</button>
                <button type="button" class="btn btn-danger confirm-delete">نعم، حذف</button>
            </div>
        </div>
    `;
  document.body.appendChild(overlay);

  overlay
    .querySelector(".confirm-cancel")
    .addEventListener("click", () => overlay.remove());
  overlay.querySelector(".confirm-delete").addEventListener("click", () => {
    card.remove();
    renumberDeductionCards();
    calcInvoiceTotals();
    overlay.remove();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function renumberDeductionCards() {
  const container = document.getElementById("deductionCardsContainer");
  if (!container) return;
  const cards = container.querySelectorAll(".deduction-card");
  cards.forEach((card, idx) => {
    const numEl = card.querySelector(".deduction-card-number");
    if (numEl) numEl.innerHTML = `📦 استقطاع #${idx + 1}`;
  });
}

/**
 * Refresh all deduction multi-select dropdowns with the latest component defs
 * (static components + dynamic detailed items).
 * Called after saving/deleting a detailed item.
 */
function refreshDeductionMultiSelects() {
  const allDefs = getInvoiceComponentDefs();
  const allKeys = allDefs.map((c) => c.key);

  document
    .querySelectorAll("#deductionCardsContainer .deduction-card")
    .forEach((card) => {
      const msMenu = card.querySelector(".ms-list");
      if (!msMenu) return;

      // Save currently selected keys
      const msBtn = card.querySelector(".ms-btn");
      const prevSelected =
        msBtn?.getAttribute("data-selected")?.split(",").filter(Boolean) || [];

      // Rebuild the menu items
      msMenu.innerHTML = allDefs
        .map((def) => {
          const isChecked =
            prevSelected.includes(def.key) || allKeys.includes(def.key);
          return `
                <label class="ms-item">
                    <input type="checkbox" value="${def.key}" ${prevSelected.includes(def.key) ? "checked" : ""}>
                    ${escapeHtml(def.name)}
                </label>
            `;
        })
        .join("");

      // Rebind checkbox events
      msMenu.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
        chk.addEventListener("change", () => updateMultiSelectLabel(chk));
      });

      // Update the button label
      if (msBtn) {
        const countSpan = msBtn.querySelector(".ms-count");
        if (countSpan) countSpan.innerText = prevSelected.length;
        msBtn.setAttribute("data-selected", prevSelected.join(","));
      }
    });
}

function addInvDeductionRow(data = null) {
  const container = document.getElementById("deductionCardsContainer");
  if (!container) return;

  const allDefs = getInvoiceComponentDefs();
  let selKeys = data
    ? resolveDeductionSelectedKeys(data)
    : allDefs.map((c) => c.key);
  // Default to all keys if empty (e.g. adding from library with no calcFromKeys)
  if (!selKeys || selKeys.length === 0) selKeys = allDefs.map((c) => c.key);
  const libInfo = getDeductionLibraryOptions(data);
  if (!libInfo.library.length) {
    alert(
      "لا توجد استقطاعات في المكتبة. أضف الاستقطاع أولاً إلى مكتبة الاستقطاعات.",
    );
    openDeductionLibrary();
    return;
  }

  const cardIndex = container.querySelectorAll(".deduction-card").length + 1;
  const isPercent = data ? data.calcType === "percent" : true;
  // New deductions default to "follow up in claims" ON, so every new
  // deduction automatically enters the التعليات workflow without the
  // user having to remember to flip a switch. Editing an existing
  // deduction still respects whatever was explicitly saved for it.
  const isFollowUpChecked = data ? Boolean(data.isRefundable) : true;

  const card = document.createElement("div");
  card.className = "deduction-card";
  card.setAttribute("data-ded-index", cardIndex);
  if (data && data.id) card.setAttribute("data-ded-id", data.id);
  card.innerHTML = `
        <div class="deduction-card-header">
            <span class="deduction-card-number">📦 استقطاع #${cardIndex}</span>
            <button type="button" class="deduction-card-delete" title="حذف الاستقطاع">🗑</button>
        </div>
        <div class="deduction-card-body">
            <div class="form-group">
                <label>اسم الاستقطاع</label>
                <select class="form-select ded-desc" data-library-id="${libInfo.selectedId}">
                    <option value="">اختر الاستقطاع</option>
                    ${libInfo.library.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === libInfo.selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
                </select>
            </div>
            <div class="form-group">
                <label>النوع</label>
                <select class="form-select ded-type">
                    <option value="percent" ${isPercent ? "selected" : ""}>نسبة %</option>
                    <option value="fixed" ${!isPercent ? "selected" : ""}>مبلغ ثابت</option>
                </select>
            </div>
            <div class="form-group span-full">
                <label>الحساب الأساسي (البنود المطلوب الحساب منها)</label>
                <div class="ms-wrapper">
                    <button type="button" class="ms-btn">اختر البنود (<span class="ms-count">${selKeys.length}</span>)</button>
                    <div class="ms-menu">
                        <div class="ms-actions">
                            <button type="button" class="ms-action-btn">تحديد الكل</button>
                            <button type="button" class="ms-action-btn">إلغاء الكل</button>
                        </div>
                        <div class="ms-list">
                            ${allDefs
                              .map(
                                (def) => `
                                <label class="ms-item">
                                    <input type="checkbox" value="${def.key}" ${selKeys.includes(def.key) ? "checked" : ""}>
                                    ${def.name}
                                </label>
                            `,
                              )
                              .join("")}
                        </div>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label>القيمة <span class="ded-val-label">(${isPercent ? "%" : "مبلغ ثابت"})</span></label>
                <input type="number" step="any" class="form-control ded-val" value="${data ? (data.val !== undefined ? data.val : data.amount) || 0 : 0}">
            </div>
            <div class="form-group">
                <label>المبلغ المحسوب</label>
                <div class="deduction-calculated-amount ded-amount">0.00</div>
            </div>
            <div class="form-group">
                <label>متابعة في التعليات (يرد/ لا يرد)</label>
                <div class="deduction-toggle-wrapper">
                    <label class="deduction-toggle">
                        <input type="checkbox" class="ded-refund" ${isFollowUpChecked ? "checked" : ""}>
                        <span class="deduction-toggle-slider"></span>
                    </label>
                    <span class="deduction-toggle-label">${isFollowUpChecked ? "نعم" : "لا"}</span>
                </div>
            </div>
        </div>
    `;
  container.appendChild(card);

  // Hide empty state, show cards
  const emptyState = document.getElementById("deductionEmptyState");
  if (emptyState) emptyState.style.display = "none";

  // Bind delete button
  card
    .querySelector(".deduction-card-delete")
    .addEventListener("click", () => confirmDeleteDeductionCard(card));

  // Bind type change to update label
  card.querySelector(".ded-type").addEventListener("change", (e) => {
    const label = card.querySelector(".ded-val-label");
    if (label)
      label.textContent = e.target.value === "percent" ? "%" : "مبلغ ثابت";
    calcInvoiceTotals();
  });

  // Bind refund toggle label
  card.querySelector(".ded-refund").addEventListener("change", (e) => {
    const toggleLabel = card.querySelector(".deduction-toggle-label");
    if (toggleLabel) toggleLabel.textContent = e.target.checked ? "نعم" : "لا";
  });

  // Bind multi-select button
  const msBtn = card.querySelector(".ms-btn");
  if (msBtn) msBtn.setAttribute("data-selected", selKeys.join(","));

  // Bind calc on any input change
  card
    .querySelectorAll("input, select")
    .forEach((inp) => inp.addEventListener("input", calcInvoiceTotals));
  calcInvoiceTotals();
}

function toggleMultiSelect(btn) {
  document.querySelectorAll(".ms-menu.open").forEach((m) => {
    if (m !== btn.nextElementSibling) m.classList.remove("open");
  });
  btn.nextElementSibling.classList.toggle("open");
}

function selectAllMs(actionBtn, selectAll) {
  const menu = actionBtn.closest(".ms-menu");
  menu.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
    chk.checked = selectAll;
  });
  updateMultiSelectLabel(menu.querySelector("input"));
}

function updateMultiSelectLabel(chk) {
  const menu = chk.closest(".ms-menu");
  const wrapper = menu.closest(".ms-wrapper");
  const btn = wrapper.querySelector(".ms-btn");
  const countSpan = wrapper.querySelector(".ms-count");

  const checked = Array.from(
    menu.querySelectorAll('input[type="checkbox"]:checked'),
  );
  const keys = checked.map((c) => c.value);

  countSpan.innerText = keys.length;
  btn.setAttribute("data-selected", keys.join(","));
  calcInvoiceTotals();
}

async function saveInvoice() {
  if (
    !assertCan(
      "invoices",
      document.getElementById("invoiceId")?.value ? "edit" : "create",
      "حفظ المستخلص",
    )
  )
    return;
  const id = document.getElementById("invoiceId").value;
  const contractId = document.getElementById("invContractId").value;
  const number = document.getElementById("invNumber").value.trim();
  const date = document.getElementById("invDate").value;

  if (!contractId || !number || !date) {
    alert("يرجى استكمال الحقول الأساسية المطلوبة");
    return;
  }

  const contract = state.contracts.find((c) => c.id === contractId) || {};
  const project = state.projects.find((p) => p.id === contract.projectId) || {};

  const workVolume =
    parseFloat(document.getElementById("invWorkVolume").value) || 0;
  const variationOrders =
    parseFloat(document.getElementById("invVariationOrders").value) || 0;
  const materials =
    parseFloat(document.getElementById("invMaterials").value) || 0;
  const claims = parseFloat(document.getElementById("invClaims").value) || 0;
  const vat = parseFloat(document.getElementById("invVat").value) || 0;

  const items = [];
  document.querySelectorAll("#tblInvItems tbody tr").forEach((tr) => {
    items.push({
      description: tr.querySelector(".item-desc").value.trim(),
      qty: parseFloat(tr.querySelector(".item-qty").value) || 0,
      rate: parseFloat(tr.querySelector(".item-rate").value) || 0,
      total:
        (parseFloat(tr.querySelector(".item-qty").value) || 0) *
        (parseFloat(tr.querySelector(".item-rate").value) || 0),
    });
  });

  const deductions = [];
  document
    .querySelectorAll("#deductionCardsContainer .deduction-card")
    .forEach((card) => {
      const msBtn = card.querySelector(".ms-btn");
      const selectedKeys = msBtn
        ? msBtn.getAttribute("data-selected")?.split(",").filter(Boolean)
        : [];
      deductions.push({
        id: card.getAttribute("data-ded-id") || generateId(12),
        description:
          card
            .querySelector(".ded-desc")
            ?.selectedOptions?.[0]?.textContent.trim() || "",
        libraryId:
          card.querySelector(".ded-desc").getAttribute("data-library-id") ||
          card.querySelector(".ded-desc").value ||
          "",
        calcType: card.querySelector(".ded-type").value,
        calcFromKeys: selectedKeys,
        val: parseFloat(card.querySelector(".ded-val").value) || 0,
        amount:
          parseFloat(
            card.querySelector(".ded-amount")?.textContent?.replace(/,/g, "") ||
              "0",
          ) || 0,
        isRefundable: card.querySelector(".ded-refund").checked,
      });
    });

  const apiPayload = {
    id: id || null,
    contractId,
    number,
    date: toDateOnly(date),
    dueDate: toDateOnly(document.getElementById("invDueDate").value),
    status: document.getElementById("invStatus").value || "Draft",
    paymentStatus:
      document.getElementById("invPaymentStatus").value || "Pending",
    paidAmount: parseFloat(document.getElementById("invPaidAmount").value) || 0,
    paymentDate: toDateOnly(document.getElementById("invPaymentDate").value),
    workVolume,
    variationOrders,
    materials,
    claims,
    vat,
    items: items.map((i) => ({ id: null, ...i, currentTotal: i.total })),
    deductions: deductions.map((d) => ({
      id: d.id,
      description: d.description,
      calcType: d.calcType,
      val: d.val,
      amount: d.amount,
      isRefundable: d.isRefundable,
      calcFromKeys: d.calcFromKeys,
    })),
  };

  try {
    if (id) {
      await erpApi.invoices.update(id, apiPayload);
    } else {
      await erpApi.invoices.create(apiPayload);
    }
    await syncStateFromBackend();
  } catch (error) {
    console.error("Save invoice failed:", error);
    alert("حدث خطأ أثناء حفظ المستخلص: " + (error.message || ""));
    return;
  }

  document.getElementById("modalInvoice").classList.remove("active");
  applyGlobalFilters();
  alert("تم حفظ المستخلص بنجاح");
}

function printInvoice(id) {
  const inv = state.invoices.find((x) => x.id === id);
  if (!inv) {
    alert("المستخلص غير موجود");
    return;
  }
  const contract = state.contracts.find((c) => c.id === inv.contractId) || {};
  const project = state.projects.find((p) => p.id === contract.projectId) || {};
  const owner = state.owners.find((o) => o.id === project.ownerId) || {};
  const gross =
    typeof getInvoiceGross === "function" ? getInvoiceGross(inv) : 0;
  const net = typeof getInvoiceNet === "function" ? getInvoiceNet(inv) : 0;
  const paid = parseFloat(inv.paidAmount) || 0;
  const statusMap = {
    Draft: "مسودة",
    Review: "مراجعة",
    Approved: "معتمد",
    Rejected: "مرفوض",
  };
  const payMap = { Pending: "معلق", Paid: "مدفوع", Partial: "جزئي" };
  const statusAr = statusMap[inv.status] || inv.status || "-";
  const payAr = payMap[inv.paymentStatus] || inv.paymentStatus || "-";

  // مكونات المستخلص الحالية فقط (مش حتى تاريخه)
  const current =
    typeof getInvoiceCurrentComponents === "function"
      ? getInvoiceCurrentComponents(inv, state.invoices)
      : {
          workVolume: parseFloat(inv.workVolume) || 0,
          variationOrders: parseFloat(inv.variationOrders) || 0,
          materials: parseFloat(inv.materials) || 0,
          claims: parseFloat(inv.claims) || 0,
          vat: parseFloat(inv.vat) || 0,
        };

  const components = [
    { label: "قيمة الأعمال المنفذة", key: "workVolume" },
    { label: "قيمة VO (أعمال إضافية)", key: "variationOrders" },
    { label: "قيمة التشوينات", key: "materials" },
    { label: "قيمة التعويضات", key: "claims" },
    { label: "ضريبة القيمة المضافة", key: "vat" },
  ];
  const compRows = components
    .map((c, i) => {
      const val = parseFloat(current[c.key]) || 0;
      return `<tr class="${i % 2 ? "alt" : ""}"><td>${c.label}</td><td class="num">${fmtNum(val)}</td></tr>`;
    })
    .join("");
  // إجمالي المكونات = إجمالي المستخلص (المكونات الحالية) من شاشة المكونات
  const compTotal = gross;

  const items = Array.isArray(inv.items) ? inv.items : [];
  const itemRows = items.length
    ? items
        .map((it, i) => {
          const qty = parseFloat(it.qty) || 0;
          const rate = parseFloat(it.rate) || 0;
          const total = parseFloat(it.total ?? it.currentTotal) || qty * rate;
          return `<tr class="${i % 2 ? "alt" : ""}">
                <td>${i + 1}</td>
                <td class="right">${escapeHtml(it.description || "-")}</td>
                <td class="num">${fmtNum(qty, 3)}</td>
                <td class="num">${fmtNum(rate)}</td>
                <td class="num">${fmtNum(total)}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="empty">لا توجد بنود تفصيلية</td></tr>`;

  const deds = Array.isArray(inv.deductions) ? inv.deductions : [];
  const dedRows = deds.length
    ? deds
        .map((d, i) => {
          const amt = parseFloat(d.amount) || parseFloat(d.val) || 0;
          const follow = d.isRefundable ? "نعم" : "لا";
          const typeAr =
            d.calcType === "percent" || d.calcType === "%"
              ? "نسبة %"
              : "مبلغ ثابت";
          return `<tr class="${i % 2 ? "alt" : ""}">
                <td>${i + 1}</td>
                <td class="right">${escapeHtml(d.description || "-")}</td>
                <td>${typeAr}</td>
                <td class="num">${fmtNum(d.val)}</td>
                <td class="num">${fmtNum(amt)}</td>
                <td>${follow}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="empty">لا توجد استقطاعات</td></tr>`;
  const dedTotal = deds.reduce(
    (s, d) => s + (parseFloat(d.amount) || parseFloat(d.val) || 0),
    0,
  );

  const printDate = new Date().toLocaleString("ar-EG");
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>مستخلص ${escapeHtml(inv.number || "")}</title>
<style>
  @page { size: A3 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    color: #0f172a;
    margin: 0;
    padding: 0;
    background: #fff;
    font-size: 11pt;
  }
  .sheet { padding: 4mm 2mm; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #1e3a5f;
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .header h1 {
    margin: 0 0 4px;
    font-size: 20pt;
    color: #1e3a5f;
  }
  .header .sub { color: #64748b; font-size: 10pt; }
  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 9pt;
    font-weight: 700;
    background: #e2e8f0;
    color: #1e3a5f;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px 14px;
    margin-bottom: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 14px;
  }
  .meta-item label {
    display: block;
    font-size: 8.5pt;
    color: #64748b;
    margin-bottom: 2px;
  }
  .meta-item .val {
    font-weight: 700;
    font-size: 11pt;
    color: #0f172a;
  }
  .section-title {
    background: #1e3a5f;
    color: #fff;
    padding: 7px 12px;
    font-size: 11pt;
    font-weight: 700;
    border-radius: 6px 6px 0 0;
    margin: 16px 0 0;
  }
  table.data {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    font-size: 10pt;
  }
  table.data th {
    background: #e2e8f0;
    color: #1e293b;
    padding: 7px 8px;
    border: 1px solid #cbd5e1;
    font-weight: 700;
    text-align: center;
  }
  table.data td {
    padding: 6px 8px;
    border: 1px solid #e2e8f0;
    vertical-align: middle;
  }
  table.data tr.alt td { background: #f8fafc; }
  table.data td.num, table.data th.num {
    text-align: left;
    direction: ltr;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  table.data td.right { text-align: right; }
  table.data td.empty {
    text-align: center;
    color: #94a3b8;
    padding: 14px;
  }
  .totals {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-top: 16px;
  }
  .tot-card {
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 10px 12px;
    background: #fff;
  }
  .tot-card .lbl { font-size: 8.5pt; color: #64748b; }
  .tot-card .val {
    font-size: 14pt;
    font-weight: 800;
    color: #1e3a5f;
    direction: ltr;
    text-align: left;
    margin-top: 4px;
  }
  .tot-card.accent { background: #1e3a5f; border-color: #1e3a5f; }
  .tot-card.accent .lbl, .tot-card.accent .val { color: #fff; }
  .footer {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    font-size: 8.5pt;
    color: #94a3b8;
  }
  .signs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-top: 28px;
  }
  .sign {
    text-align: center;
    border-top: 1px solid #94a3b8;
    padding-top: 8px;
    font-size: 9.5pt;
    color: #475569;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <h1>مستخلص مقاولات</h1>
        <div class="sub">Construction Invoice — Follow Up Control</div>
      </div>
      <div style="text-align:left">
        <div style="font-size:14pt;font-weight:800;color:#1e3a5f">${escapeHtml(inv.number || "-")}</div>
        <div style="margin-top:6px"><span class="badge">${escapeHtml(statusAr)}</span>
        <span class="badge" style="margin-right:6px">${escapeHtml(payAr)}</span></div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-item"><label>المالك</label><div class="val">${escapeHtml(owner.name || "-")}</div></div>
      <div class="meta-item"><label>المشروع</label><div class="val">${escapeHtml(project.name || "-")}</div></div>
      <div class="meta-item"><label>العقد</label><div class="val">${escapeHtml(contract.name || "-")}</div></div>
      <div class="meta-item"><label>رقم المستخلص</label><div class="val">${escapeHtml(inv.number || "-")}</div></div>
      <div class="meta-item"><label>تاريخ المستخلص</label><div class="val">${fmtDisplayDate(inv.date)}</div></div>
      <div class="meta-item"><label>تاريخ الاستحقاق</label><div class="val">${fmtDisplayDate(inv.dueDate)}</div></div>
      <div class="meta-item"><label>تاريخ السداد</label><div class="val">${fmtDisplayDate(inv.paymentDate) || "—"}</div></div>
      <div class="meta-item"><label>حالة السداد</label><div class="val">${escapeHtml(payAr)}</div></div>
    </div>

    <div class="section-title">مكونات المستخلص (الحالية)</div>
    <table class="data">
      <thead><tr><th>البند</th><th class="num">القيمة</th></tr></thead>
      <tbody>
        ${compRows}
        <tr style="font-weight:800;background:#eef2ff">
          <td>إجمالي المكونات</td><td class="num">${fmtNum(compTotal)}</td>
        </tr>
      </tbody>
    </table>

    <div class="section-title">البنود التفصيلية</div>
    <table class="data">
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>الوصف</th>
          <th style="width:90px">الكمية</th>
          <th style="width:110px">الفئة</th>
          <th style="width:120px">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="section-title">الاستقطاعات</div>
    <table class="data">
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>الوصف</th>
          <th style="width:100px">النوع</th>
          <th style="width:90px">القيمة</th>
          <th style="width:110px">المبلغ</th>
          <th style="width:90px">متابعة التعليات</th>
        </tr>
      </thead>
      <tbody>${dedRows}</tbody>
      <tfoot>
        <tr style="font-weight:800;background:#fef3c7">
          <td colspan="4">إجمالي الاستقطاعات</td>
          <td class="num">${fmtNum(dedTotal)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    <div class="totals" style="grid-template-columns:repeat(3,1fr)">
      <div class="tot-card"><div class="lbl">إجمالي المستخلص (المكونات الحالية)</div><div class="val">${fmtNum(gross)}</div></div>
      <div class="tot-card"><div class="lbl">إجمالي الاستقطاعات</div><div class="val">${fmtNum(dedTotal)}</div></div>
      <div class="tot-card accent"><div class="lbl">الصافي المستحق (Net)</div><div class="val">${fmtNum(net)}</div></div>
    </div>

    <div class="signs">
      <div class="sign">المهندس المسؤول</div>
      <div class="sign">الحسابات</div>
      <div class="sign">الاعتماد</div>
    </div>

    <div class="footer">
      <span>Follow Up Control — طباعة مستخلص</span>
      <span>${printDate}</span>
    </div>
  </div>
  <script>
    window.onload = function () {
      setTimeout(function () { window.focus(); window.print(); }, 250);
    };
  </script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=1200,height=800");
  if (!w) {
    alert("برجاء السماح بالنوافذ المنبثقة للطباعة");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function editInvoice(id) {
  if (!assertCan("invoices", "edit", "تعديل المستخلص")) return;
  openInvoiceModal(id);
}

async function deleteInvoice(id) {
  if (!assertCan("invoices", "delete", "حذف المستخلص")) return;
  if (
    !(await erpNotify.showConfirm("هل أنت متأكد من حذف هذا المستخلص؟", {
      title: "تأكيد الحذف",
      confirmText: "حذف",
      cancelText: "إلغاء",
    }))
  )
    return;
  try {
    await erpApi.invoices.remove(id);
    await syncStateFromBackend();
    applyGlobalFilters();
  } catch (error) {
    console.error("Delete invoice failed:", error);
    alert("حدث خطأ أثناء حذف المستخلص: " + (error.message || ""));
  }
}

/* ========================= SOCIAL INSURANCE MODULE ========================= */
const SOCIAL_INSURANCE_STORAGE_KEY = "erp_social_insurance";

function ensureSocialInsuranceState() {
  if (!state.socialInsurance || typeof state.socialInsurance !== "object")
    state.socialInsurance = {};
  if (
    !state.socialInsurance.contracts ||
    typeof state.socialInsurance.contracts !== "object"
  )
    state.socialInsurance.contracts = {};
  if (
    !state.socialInsurance.payments ||
    typeof state.socialInsurance.payments !== "object"
  )
    state.socialInsurance.payments = {};
  return state.socialInsurance;
}

function normalizeArabicText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSocialInsuranceDeduction(deduction) {
  if (!deduction) return false;
  const library = getDeductionLibrary();
  const libItem = library.find((x) => x.id === deduction.libraryId);
  const name = normalizeArabicText(
    libItem?.name || deduction.description || "",
  );
  return name.includes("تامينات اجتماعي") || name.includes("تامين اجتماعي");
}

function getSocialInsuranceDeductionAmount(inv) {
  if (!inv || !Array.isArray(inv.deductions)) return 0;
  return inv.deductions.reduce((sum, d) => {
    return (
      sum + (isSocialInsuranceDeduction(d) ? parseFloat(d.amount) || 0 : 0)
    );
  }, 0);
}

function getSocialInsuranceContractRecord(contractId) {
  ensureSocialInsuranceState();
  if (!state.socialInsurance.contracts[contractId]) {
    const contract = state.contracts.find((c) => c.id === contractId) || {};
    state.socialInsurance.contracts[contractId] = {
      contractId,
      translationStatus: "لم تبدأ",
      boqStatus: "لم يتم تجهيزها",
      fileStatus: "لم يبدأ",
      fileNumber: "",
      fileRate: 0,
      objectionStatus: "لا يوجد اعتراض",
      objectionDate: "",
      openingDate: "",
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contractSignDateSnapshot: contract.signDate || "",
    };
  }
  return state.socialInsurance.contracts[contractId];
}

function syncSocialInsuranceFromInvoice(inv) {
  ensureSocialInsuranceState();
  if (!inv) return;
  const amount = getSocialInsuranceDeductionAmount(inv);
  if (amount <= 0) {
    delete state.socialInsurance.payments[inv.id];
    return;
  }
  getSocialInsuranceContractRecord(inv.contractId);
  const old = state.socialInsurance.payments[inv.id] || {};
  const paid = Math.max(0, parseFloat(old.paidAmount) || 0);
  const status =
    paid >= amount && amount > 0
      ? "مسدد"
      : paid > 0
        ? "مسدد جزئياً"
        : "غير مسدد";
  state.socialInsurance.payments[inv.id] = {
    invoiceId: inv.id,
    contractId: inv.contractId,
    amount,
    paidAmount: Math.min(paid, amount),
    status,
    paymentDate: old.paymentDate || "",
    reference: old.reference || "",
    notes: old.notes || "",
    updatedAt: new Date().toISOString(),
  };
}

function syncAllSocialInsuranceInvoices() {
  ensureSocialInsuranceState();
  state.invoices.forEach(syncSocialInsuranceFromInvoice);
  Object.keys(state.socialInsurance.payments).forEach((invoiceId) => {
    if (!state.invoices.some((inv) => inv.id === invoiceId))
      delete state.socialInsurance.payments[invoiceId];
  });
}

function socialInsuranceStatusBadge(status) {
  const cls =
    status === "مكتمل" ||
    status === "مسدد" ||
    status === "جاهزة" ||
    status === "لا يوجد اعتراض"
      ? "badge-success"
      : status === "قيد التجهيز" ||
          status === "قيد الترجمة" ||
          status === "مسدد جزئياً" ||
          status === "قيد المراجعة"
        ? "badge-warning"
        : status === "تم الاعتراض" ||
            status === "غير مسدد" ||
            status === "لم يبدأ" ||
            status === "لم تبدأ" ||
            status === "لم يتم تجهيزها"
          ? "badge-danger"
          : "badge-primary";
  return `<span class="badge ${cls}">${escapeHtml(status || "-")}</span>`;
}

function getSocialInsuranceFilteredContracts(filteredData) {
  const search = (document.getElementById("searchSocialInsurance")?.value || "")
    .trim()
    .toLowerCase();
  const fileStatus = document.getElementById("siFilterFileStatus")?.value || "";
  return (filteredData?.contracts || state.contracts).filter((contract) => {
    const rec = getSocialInsuranceContractRecord(contract.id);
    if (fileStatus && rec.fileStatus !== fileStatus) return false;
    if (!search) return true;
    const project =
      state.projects.find((p) => p.id === contract.projectId) || {};
    const owner = state.owners.find((o) => o.id === project.ownerId) || {};
    const hay = [
      owner.name,
      project.name,
      contract.name,
      contract.id,
      rec.fileNumber,
      rec.fileStatus,
      rec.translationStatus,
      rec.boqStatus,
      rec.objectionStatus,
      rec.notes,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(search);
  });
}

function getSocialInsuranceInvoiceRows(filteredData) {
  const paymentFilter =
    document.getElementById("siFilterPaymentStatus")?.value || "";
  const search = (document.getElementById("searchSocialInsurance")?.value || "")
    .trim()
    .toLowerCase();
  const invoices = (filteredData?.invoices || state.invoices).filter(
    (inv) => getSocialInsuranceDeductionAmount(inv) > 0,
  );
  return invoices
    .map((inv) => {
      syncSocialInsuranceFromInvoice(inv);
      const payment = state.socialInsurance.payments[inv.id] || {};
      const amount = getSocialInsuranceDeductionAmount(inv);
      const paid = Math.min(
        amount,
        Math.max(0, parseFloat(payment.paidAmount) || 0),
      );
      const outstanding = Math.max(0, amount - paid);
      const status =
        paid >= amount ? "مسدد" : paid > 0 ? "مسدد جزئياً" : "غير مسدد";
      const contract =
        state.contracts.find((c) => c.id === inv.contractId) || {};
      const project =
        state.projects.find((p) => p.id === contract.projectId) || {};
      const owner = state.owners.find((o) => o.id === project.ownerId) || {};
      return {
        inv,
        payment,
        amount,
        paid,
        outstanding,
        status,
        contract,
        project,
        owner,
      };
    })
    .filter((row) => {
      if (paymentFilter && row.status !== paymentFilter) return false;
      if (!search) return true;
      const hay = [
        row.inv.number,
        row.inv.date,
        row.owner.name,
        row.project.name,
        row.contract.name,
        row.amount,
        row.status,
        row.payment.reference,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(search);
    });
}

function renderSocialInsurance(data) {
  const sourceData = data || filteredData;
  if (!document.getElementById("socialInsuranceView")) return;
  ensureSocialInsuranceState();
  state.contracts.forEach((c) => getSocialInsuranceContractRecord(c.id));
  syncAllSocialInsuranceInvoices();

  const contracts = getSocialInsuranceFilteredContracts(sourceData);
  const invoiceRows = getSocialInsuranceInvoiceRows(sourceData);
  const totalDue = invoiceRows.reduce((s, r) => s + r.amount, 0);
  const totalPaid = invoiceRows.reduce((s, r) => s + r.paid, 0);
  const totalOutstanding = invoiceRows.reduce((s, r) => s + r.outstanding, 0);
  const ready = contracts.filter((c) => {
    const r = getSocialInsuranceContractRecord(c.id);
    return (
      r.fileStatus === "مكتمل" &&
      ["مكتملة", "غير مطلوبة"].includes(r.translationStatus) &&
      ["جاهزة", "غير مطلوبة"].includes(r.boqStatus)
    );
  }).length;
  const pending = contracts.filter(
    (c) => getSocialInsuranceContractRecord(c.id).fileStatus !== "مكتمل",
  ).length;
  const objections = contracts.filter((c) =>
    ["تم الاعتراض", "قيد المراجعة"].includes(
      getSocialInsuranceContractRecord(c.id).objectionStatus,
    ),
  ).length;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };
  setText("siKpiContracts", fmtNum(contracts.length, 0));
  setText("siKpiReady", fmtNum(ready, 0));
  setText("siKpiPending", fmtNum(pending, 0));
  setText("siKpiObjections", fmtNum(objections, 0));
  ["siKpiDue", "siKpiOutstanding"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      const v = id === "siKpiDue" ? totalDue : totalOutstanding;
      el.innerText = fmtNumShort(v);
      el.setAttribute("data-full", fmtNum(v));
    }
  });

  const tbody = document.querySelector("#tblSocialInsuranceContracts tbody");
  // --- Contracts table with pagination ---
  renderPaginatedTable(
    "siContracts",
    contracts,
    "siContractsPagination",
    "#tblSocialInsuranceContracts tbody",
    13,
    (slicedContracts) => {
      slicedContracts.forEach((c) => {
        const r = getSocialInsuranceContractRecord(c.id);
        const project = state.projects.find((p) => p.id === c.projectId) || {};
        const owner = state.owners.find((o) => o.id === project.ownerId) || {};
        const contractDue = invoiceRows
          .filter((x) => x.inv.contractId === c.id)
          .reduce((s, x) => s + x.amount, 0);
        const contractOutstanding = invoiceRows
          .filter((x) => x.inv.contractId === c.id)
          .reduce((s, x) => s + x.outstanding, 0);
        const tr = document.createElement("tr");
        tr.setAttribute("data-contract-id", c.id);
        tr.innerHTML = `<td>${escapeHtml(owner.name || "-")}</td><td>${escapeHtml(project.name || "-")}</td><td><strong>${escapeHtml(c.name || "-")}</strong></td>
                <td>${escapeHtml(fmtDisplayDate(c.signDate))}</td><td>${socialInsuranceStatusBadge(r.translationStatus)}</td><td>${socialInsuranceStatusBadge(r.boqStatus)}</td><td>${socialInsuranceStatusBadge(r.fileStatus)}</td>
                <td>${escapeHtml(r.fileNumber || "-")}</td><td>${fmtNum(r.fileRate || 0, 2)}%</td><td>${socialInsuranceStatusBadge(r.objectionStatus)}</td>
                <td>${fmtNum(contractDue)}</td><td>${fmtNum(contractOutstanding)}</td>
                <td><button type="button" class="btn btn-secondary btn-sm" data-si-edit-contract="${escapeHtml(c.id)}">ملف التأمينات</button></td>`;
        document
          .querySelector("#tblSocialInsuranceContracts tbody")
          .appendChild(tr);
      });
    },
  );

  // --- Invoices table with pagination ---
  renderPaginatedTable(
    "siInvoices",
    invoiceRows,
    "siInvoicesPagination",
    "#tblSocialInsuranceInvoices tbody",
    12,
    (slicedInvoices) => {
      slicedInvoices.forEach((row) => {
        const tr = document.createElement("tr");
        tr.setAttribute("data-invoice-id", row.inv.id);
        tr.innerHTML = `<td><strong>${escapeHtml(row.inv.number || "-")}</strong></td><td>${escapeHtml(fmtDisplayDate(row.inv.date))}</td><td>${escapeHtml(row.owner.name || "-")}</td><td>${escapeHtml(row.project.name || "-")}</td><td>${escapeHtml(row.contract.name || "-")}</td>
                <td>${fmtNum(row.amount)}</td><td>${socialInsuranceStatusBadge(row.status)}</td><td>${fmtNum(row.paid)}</td><td>${fmtNum(row.outstanding)}</td>
                <td>${fmtDisplayDate(row.payment.paymentDate)}</td><td>${escapeHtml(row.payment.reference || "-")}</td>
                <td><button type="button" class="btn btn-primary btn-sm" data-si-pay-invoice="${escapeHtml(row.inv.id)}">${row.status === "مسدد" ? "عرض السداد" : "تسجيل السداد"}</button></td>`;
        document
          .querySelector("#tblSocialInsuranceInvoices tbody")
          .appendChild(tr);
      });
    },
  );

  setText("siFootDue", fmtNum(totalDue));
  setText("siFootPaid", fmtNum(totalPaid));
  setText("siFootOutstanding", fmtNum(totalOutstanding));
}

function updateSocialInsuranceChecklist() {
  const box = document.getElementById("siChecklistPreview");
  if (!box) return;
  const items = [
    ["ترجمة العقد", document.getElementById("siTranslationStatus")?.value],
    ["المقايسة", document.getElementById("siBoqStatus")?.value],
    ["فتح الملف", document.getElementById("siFileStatus")?.value],
    ["الاعتراض", document.getElementById("siObjectionStatus")?.value],
  ];
  box.innerHTML = items
    .map(
      ([label, status]) =>
        `<div style="padding:.6rem .75rem;border:1px solid var(--border);border-radius:6px;background:#fff;"><strong>${escapeHtml(label)}</strong><br>${socialInsuranceStatusBadge(status)}</div>`,
    )
    .join("");
}

function openSocialInsuranceModal(contractId) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return;
  const r = getSocialInsuranceContractRecord(contractId);
  document.getElementById("siContractId").value = contractId;
  document.getElementById("siModalContractName").innerText =
    contract.name || contractId;
  setInputDate(
    "siContractSignDate",
    contract.signDate || r.contractSignDateSnapshot || "",
  );
  document.getElementById("siTranslationStatus").value =
    r.translationStatus || "لم تبدأ";
  document.getElementById("siBoqStatus").value =
    r.boqStatus || "لم يتم تجهيزها";
  document.getElementById("siFileStatus").value = r.fileStatus || "لم يبدأ";
  document.getElementById("siFileNumber").value = r.fileNumber || "";
  document.getElementById("siFileRate").value = r.fileRate ?? 0;
  document.getElementById("siObjectionStatus").value =
    r.objectionStatus || "لا يوجد اعتراض";
  setInputDate("siObjectionDate", r.objectionDate);
  setInputDate("siOpeningDate", r.openingDate);
  document.getElementById("siNotes").value = r.notes || "";
  updateSocialInsuranceChecklist();
  document.getElementById("modalSocialInsurance").classList.add("active");
  initFlatpickr();
}

function closeSocialInsuranceModal() {
  document.getElementById("modalSocialInsurance")?.classList.remove("active");
}

async function saveSocialInsuranceRecord() {
  const contractId = document.getElementById("siContractId")?.value;
  if (!contractId) return;

  const dto = {
    contractId,
    translationStatus: document.getElementById("siTranslationStatus").value,
    boqStatus: document.getElementById("siBoqStatus").value,
    fileStatus: document.getElementById("siFileStatus").value,
    fileNumber: document.getElementById("siFileNumber").value.trim() || null,
    fileRate: Math.max(
      0,
      parseFloat(document.getElementById("siFileRate").value) || 0,
    ),
    objectionStatus: document.getElementById("siObjectionStatus").value,
    objectionDate: toDateOnly(document.getElementById("siObjectionDate").value),
    openingDate: toDateOnly(document.getElementById("siOpeningDate").value),
    notes: document.getElementById("siNotes").value.trim() || null,
  };

  try {
    await erpApi.socialInsurance.updateContract(contractId, dto);
    await syncStateFromBackend();
  } catch (error) {
    console.error("Save social insurance record failed:", error);
    alert("حدث خطأ أثناء حفظ بيانات التأمينات: " + (error.message || ""));
    return;
  }

  closeSocialInsuranceModal();
  renderSocialInsurance(filteredData);
}

function openSocialInsurancePaymentModal(invoiceId) {
  const inv = state.invoices.find((x) => x.id === invoiceId);
  if (!inv) return;
  const amount = getSocialInsuranceDeductionAmount(inv);
  if (amount <= 0) {
    alert("لا يوجد استقطاع تأمينات اجتماعية على هذا المستخلص.");
    return;
  }
  syncSocialInsuranceFromInvoice(inv);
  const p = state.socialInsurance.payments[invoiceId] || {};
  const contract = state.contracts.find((c) => c.id === inv.contractId) || {};
  document.getElementById("siPaymentInvoiceId").value = invoiceId;
  document.getElementById("siPaymentInvoiceInfo").innerHTML =
    `<strong>${escapeHtml(inv.number || "")}</strong> — ${escapeHtml(contract.name || "")}<br><span style="color:var(--gray);">تعلية التأمينات: ${fmtNum(amount)}</span>`;
  document.getElementById("siPaymentDue").value = amount;
  document.getElementById("siPaymentPaid").value = p.paidAmount || 0;
  document.getElementById("siPaymentStatus").value = p.status || "غير مسدد";
  setInputDate("siPaymentDate", p.paymentDate);
  document.getElementById("siPaymentReference").value = p.reference || "";
  document.getElementById("siPaymentNotes").value = p.notes || "";
  document
    .getElementById("modalSocialInsurancePayment")
    .classList.add("active");
  initFlatpickr();
}

function closeSocialInsurancePaymentModal() {
  document
    .getElementById("modalSocialInsurancePayment")
    ?.classList.remove("active");
}

async function saveSocialInsurancePayment() {
  const invoiceId = document.getElementById("siPaymentInvoiceId")?.value;
  const inv = state.invoices.find((x) => x.id === invoiceId);
  if (!inv) return;
  const amount = getSocialInsuranceDeductionAmount(inv);
  let paid = Math.max(
    0,
    parseFloat(document.getElementById("siPaymentPaid").value) || 0,
  );
  paid = Math.min(paid, amount);
  let status = document.getElementById("siPaymentStatus").value;
  if (paid >= amount && amount > 0) status = "مسدد";
  else if (paid > 0) status = "مسدد جزئياً";
  else status = "غير مسدد";

  const dto = {
    invoiceId,
    contractId: inv.contractId,
    amount,
    paidAmount: paid,
    status,
    paymentDate: toDateOnly(document.getElementById("siPaymentDate").value),
    reference:
      document.getElementById("siPaymentReference").value.trim() || null,
    notes: document.getElementById("siPaymentNotes").value.trim() || null,
  };

  try {
    await erpApi.socialInsurance.updatePayment(invoiceId, dto);
    await syncStateFromBackend();
  } catch (error) {
    console.error("Save social insurance payment failed:", error);
    alert("حدث خطأ أثناء حفظ سداد التأمينات: " + (error.message || ""));
    return;
  }

  closeSocialInsurancePaymentModal();
  applyGlobalFilters();
}

function exportSocialInsuranceReport() {
  const rows = getSocialInsuranceInvoiceRows(filteredData);
  if (!rows.length) {
    alert("لا توجد بيانات تأمينات للتصدير.");
    return;
  }
  const exportRows = rows.map((r) => ({
    "رقم المستخلص": r.inv.number,
    التاريخ: r.inv.date,
    المالك: r.owner.name,
    المشروع: r.project.name,
    العقد: r.contract.name,
    "تعلية التأمينات": r.amount,
    "حالة السداد": r.status,
    المدفوع: r.paid,
    المتبقي: r.outstanding,
    "تاريخ السداد": r.payment.paymentDate || "",
    "مرجع السداد": r.payment.reference || "",
  }));
  const ws = XLSX.utils.json_to_sheet(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Social Insurance");
  XLSX.writeFile(
    wb,
    `social_insurance_${new Date().toISOString().split("T")[0]}.xlsx`,
  );
}

/* ======================= END SOCIAL INSURANCE MODULE ======================= */

function initImportExportModule() {
  const getTodayStamp = () => getTodayLocal();

  const ensureXLSX = () => {
    if (typeof XLSX === "undefined") {
      alert(
        "مكتبة Excel غير متاحة. تأكد من الاتصال بالإنترنت ثم أعد تحميل الصفحة.",
      );
      return false;
    }
    return true;
  };

  const resetFileInput = (input) => {
    if (input) input.value = "";
  };

  const refreshAfterImport = () => {
    ensureSocialInsuranceState();
    syncAllSocialInsuranceInvoices();
    ensureDeductionLibraryInitialized();
    saveLocalStorage();
    populateDropdowns();
    applyGlobalFilters();
    if (typeof renderDashboard === "function") renderDashboard(filteredData);
    if (typeof renderSocialInsurance === "function")
      renderSocialInsurance(filteredData);
    if (typeof renderReports === "function") renderReports(filteredData);
  };

  const normalizeSheetRows = (wb, sheetName) => {
    const sheet = wb.Sheets[sheetName];
    return sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "" }) : [];
  };

  const replaceArrayIfPresent = (target, rows) =>
    Array.isArray(rows) ? rows : target;

  const btnExpJSON = document.getElementById("btnExportJSON");
  if (btnExpJSON) {
    btnExpJSON.addEventListener("click", () => {
      syncAllSocialInsuranceInvoices();
      saveLocalStorage();
      const exportData = { ...state, deductionLibrary: getDeductionLibrary() };
      const dataStr =
        "data:application/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(exportData, null, 2));
      const dlAnchor = document.createElement("a");
      dlAnchor.href = dataStr;
      dlAnchor.download = `erp_backup_${getTodayStamp()}.json`;
      document.body.appendChild(dlAnchor);
      dlAnchor.click();
      dlAnchor.remove();
    });
  }

  const fileImpJSON = document.getElementById("fileImportJSON");
  if (fileImpJSON) {
    fileImpJSON.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async function (evt) {
        try {
          const parsed = JSON.parse(evt.target.result);
          if (
            parsed.owners &&
            parsed.projects &&
            parsed.contracts &&
            parsed.invoices
          ) {
            state.owners = parsed.owners;
            state.projects = parsed.projects;
            state.contracts = parsed.contracts;
            state.invoices = parsed.invoices;
            if (parsed.escalationsResponses)
              state.escalationsResponses = parsed.escalationsResponses;
            if (parsed.execPositions)
              state.execPositions = parsed.execPositions;
            if (parsed.socialInsurance)
              state.socialInsurance = {
                contracts: {},
                payments: {},
                ...parsed.socialInsurance,
              };
            if (Array.isArray(parsed.deductionLibrary))
              saveDeductionLibrary(parsed.deductionLibrary);
            // Save old state for rollback on failure
            const oldState = {
              owners: state.owners,
              projects: state.projects,
              contracts: state.contracts,
              invoices: state.invoices,
              execPositions: state.execPositions,
              escalationsResponses: state.escalationsResponses,
              socialInsurance: state.socialInsurance,
              deductionLibrary: state.deductionLibrary
                ? [...state.deductionLibrary]
                : [],
            };

            // Update state so buildBootstrapPayload reads the new data
            state.owners = parsed.owners;
            state.projects = parsed.projects;
            state.contracts = parsed.contracts;
            state.invoices = parsed.invoices;
            if (parsed.escalationsResponses)
              state.escalationsResponses = parsed.escalationsResponses;
            if (parsed.execPositions)
              state.execPositions = parsed.execPositions;
            if (parsed.socialInsurance)
              state.socialInsurance = {
                contracts: {},
                payments: {},
                ...parsed.socialInsurance,
              };
            if (Array.isArray(parsed.deductionLibrary))
              saveDeductionLibrary(parsed.deductionLibrary);

            const payload = buildBootstrapPayload();

            try {
              await erpApi.upsertBootstrap(payload);
              refreshAfterImport();
              alert(
                "تم استعادة النسخة الاحتياطية وحفظها في قاعدة البيانات بنجاح",
              );
            } catch (saveErr) {
              Object.assign(state, oldState);
              console.error("Backend save failed after JSON import:", saveErr);
              alert(
                "تعذر حفظ البيانات. يرجى التحقق من صحة البيانات والمحاولة مرة أخرى.",
              );
            }
          } else {
            alert("تنسيق الملف غير صالح. يرجى استخدام ملف نسخة احتياطية صحيح.");
          }
        } catch (err) {
          console.error("JSON import error:", err);
          alert(
            "تعذر قراءة الملف. يرجى التأكد من أن الملف بتنسيق صحيح والمحاولة مرة أخرى.",
          );
        } finally {
          resetFileInput(fileImpJSON);
        }
      };
      reader.readAsText(file);
    });
  }

  const btnExpFullExcel = document.getElementById("btnExportFullExcel");
  if (btnExpFullExcel) {
    btnExpFullExcel.addEventListener("click", () => {
      if (!ensureXLSX()) return;
      try {
        syncAllSocialInsuranceInvoices();
        saveLocalStorage();
        const wb = XLSX.utils.book_new();

        // Helper: create sheet with explicit headers (always present even if empty)
        const makeSheet = (rows, headers) => {
          const data = Array.isArray(rows) ? rows : [];
          const aoa = [headers];
          data.forEach((row) => {
            aoa.push(
              headers.map((h) => {
                const key = h && typeof h === "object" ? h.key : h;
                return row[key] ?? "";
              }),
            );
          });
          return XLSX.utils.aoa_to_sheet(aoa);
        };
        const addSheet = (rows, name, headers) => {
          XLSX.utils.book_append_sheet(wb, makeSheet(rows, headers), name);
        };

        // 1. Owners
        addSheet(
          state.owners || [],
          "Owners",
          [
            { key: "id", label: "id" },
            { key: "name", label: "name" },
            { key: "phone", label: "phone" },
            { key: "email", label: "email" },
          ].map((h) => h.label),
        );

        // 2. Projects
        addSheet(
          state.projects || [],
          "Projects",
          [
            { key: "id", label: "id" },
            { key: "ownerId", label: "ownerId" },
            { key: "name", label: "name" },
            { key: "startDate", label: "startDate" },
            { key: "status", label: "status" },
          ].map((h) => h.label),
        );

        // 3. Contracts
        addSheet(state.contracts || [], "Contracts", [
          "id",
          "projectId",
          "name",
          "amount",
          "modifiedAmount",
          "voAmount",
          "claimsAmount",
          "vatAmount",
          "paymentTerms",
          "signDate",
          "status",
        ]);

        // 4. Invoices
        const invHeaders = [
          "id",
          "contractId",
          "number",
          "date",
          "dueDate",
          "status",
          "paymentStatus",
          "paidAmount",
          "paymentDate",
          "workVolume",
          "variationOrders",
          "materials",
          "claims",
          "vat",
        ];
        const invRows = (state.invoices || []).map((inv) => {
          const n = normalizeInvoiceForApi(inv);
          delete n.items;
          delete n.deductions;
          return n;
        });
        addSheet(invRows, "Invoices", invHeaders);

        // 5. ExecPositions
        addSheet(state.execPositions || [], "ExecPositions", [
          "id",
          "contractId",
          "versionNumber",
          "date",
          "user",
          "workVolume",
          "variationOrders",
          "materials",
          "claims",
          "vat",
          "totalAmount",
        ]);

        // 6. SocialInsuranceFiles
        const siFiles = Object.values(state.socialInsurance?.contracts || {});
        addSheet(siFiles, "SocialInsuranceFiles", [
          "contractId",
          "translationStatus",
          "boqStatus",
          "fileStatus",
          "fileNumber",
          "fileRate",
          "objectionStatus",
          "objectionDate",
          "openingDate",
          "notes",
        ]);

        // 7. SocialInsurancePayments
        const siPay = Object.values(state.socialInsurance?.payments || {});
        addSheet(siPay, "SocialInsurancePayments", [
          "invoiceId",
          "contractId",
          "amount",
          "paidAmount",
          "status",
          "paymentDate",
          "reference",
          "notes",
        ]);

        // 8. DeductionLibrary
        addSheet(getDeductionLibrary() || [], "DeductionLibrary", [
          "id",
          "name",
        ]);

        // 9. Deductions (all invoice deductions flattened)
        const allDeductions = [];
        (state.invoices || []).forEach((inv) => {
          const contract =
            state.contracts.find((c) => c.id === inv.contractId) || {};
          (Array.isArray(inv.deductions) ? inv.deductions : []).forEach((d) => {
            allDeductions.push({
              invoiceNumber: inv.number || "",
              contractId: inv.contractId || "",
              description: d.description || "",
              calcType: d.calcType === "percent" ? "Percentage" : "Fixed",
              val: d.val || 0,
              amount: d.amount || 0,
              isRefundable: d.isRefundable ? "Yes" : "No",
              calcFromKeys: Array.isArray(d.calcFromKeys)
                ? d.calcFromKeys.join(",")
                : d.calcFromKeys || "",
            });
          });
        });
        addSheet(allDeductions, "Deductions", [
          "invoiceNumber",
          "contractId",
          "description",
          "calcType",
          "val",
          "amount",
          "isRefundable",
          "calcFromKeys",
        ]);

        XLSX.writeFile(wb, `erp_full_export_${getTodayStamp()}.xlsx`);
      } catch (err) {
        console.error("Full Excel export error:", err);
        alert("حدث خطأ أثناء تصدير البيانات إلى Excel");
      }
    });
  }

  const fileImpFullExcel = document.getElementById("fileImportFullExcel");
  if (fileImpFullExcel) {
    fileImpFullExcel.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!ensureXLSX()) {
        resetFileInput(fileImpFullExcel);
        return;
      }

      const reader = new FileReader();
      reader.onload = async function (evt) {
        try {
          const wb = XLSX.read(evt.target.result, { type: "array" });
          const owners = normalizeSheetRows(wb, "Owners");
          const projects = normalizeSheetRows(wb, "Projects");
          const contracts = normalizeSheetRows(wb, "Contracts");
          const invoices = normalizeSheetRows(wb, "Invoices");
          const invoiceItems = normalizeSheetRows(wb, "InvoiceItems");
          const invoiceDeductions = normalizeSheetRows(wb, "Deductions");
          const siContracts = normalizeSheetRows(wb, "SocialInsuranceFiles");
          const siPayments = normalizeSheetRows(wb, "SocialInsurancePayments");
          const deductionLibrary = normalizeSheetRows(wb, "DeductionLibrary");

          if (
            !owners.length &&
            !projects.length &&
            !contracts.length &&
            !invoices.length
          ) {
            throw new Error("INVALID_FULL_WORKBOOK");
          }

          if (
            !(await erpNotify.showConfirm(
              "سيتم استبدال البيانات الحالية بالبيانات الموجودة في ملف Excel. هل تريد المتابعة؟",
              {
                title: "تأكيد الاستيراد",
                confirmText: "متابعة",
                cancelText: "إلغاء",
                danger: true,
              },
            ))
          )
            return;

          // Convert Excel serial numbers to YYYY-MM-DD for all date fields
          owners.forEach((o) => {
            if (o.phone === undefined) delete o.phone;
          });
          projects.forEach((p) => {
            p.startDate = toDateOnly(p.startDate);
          });
          contracts.forEach((c) => {
            c.signDate = toDateOnly(c.signDate);
            // قيمة العقد المعدل = حصر البنود (يدوي من Excel). القيم الديناميكية تبدأ 0 إن لم تُمرَّر.
            const mod = parseFloat(c.modifiedAmount);
            c.modifiedAmount = Number.isFinite(mod) && mod >= 0 ? mod : 0;
            c.voAmount = 0;
            c.claimsAmount = 0;
            c.vatAmount = 0;
          });
          if (owners.length) state.owners = owners;
          if (projects.length) state.projects = projects;
          if (contracts.length) state.contracts = contracts;
          if (invoices.length) {
            // Rebuild items and deductions from separate sheets
            const itemsByInv = {};
            invoiceItems.forEach((row) => {
              const num = row.number || "";
              if (!num) return;
              if (!itemsByInv[num]) itemsByInv[num] = [];
              itemsByInv[num].push({
                description: row.description || "",
                qty: parseFloat(row.qty) || 0,
                rate: parseFloat(row.rate) || 0,
                total: parseFloat(row.total) || 0,
                currentTotal: parseFloat(row.currentTotal || row.total) || 0,
              });
            });
            const dedByInv = {};
            const dedImportErrors = [];
            const dedImportSeen = new Set();
            invoiceDeductions.forEach((row, rowIdx) => {
              const num = row.invoiceNumber || row.number || "";
              if (!num) {
                dedImportErrors.push(`صف ${rowIdx + 2}: رقم المستخلص فارغ`);
                return;
              }
              // Normalize calcType: handle both export and legacy formats
              let calcType = (row.calcType || "percent").toLowerCase();
              if (calcType === "percentage") calcType = "percent";
              if (calcType === "fixed") calcType = "fixed";
              if (calcType !== "percent" && calcType !== "fixed")
                calcType = "percent";

              const val = parseFloat(row.val) || 0;
              const description = row.description || "";
              if (!description) {
                dedImportErrors.push(
                  `صف ${rowIdx + 2}: اسم الاستقطاع فارغ (المستخلص ${num})`,
                );
                return;
              }
              if (val <= 0) {
                dedImportErrors.push(
                  `صف ${rowIdx + 2}: قيمة الاستقطاع غير صالحة (المستخلص ${num} - ${description})`,
                );
                return;
              }

              // Duplicate detection
              const dedKey = `${num}|${description}|${calcType}|${val}`;
              if (dedImportSeen.has(dedKey)) {
                dedImportErrors.push(
                  `استقطاع مكرر: المستخلص ${num} - ${description} (${calcType} = ${val})`,
                );
                return;
              }
              dedImportSeen.add(dedKey);

              // Normalize refund
              let isRefundable = false;
              const refundVal = row.isRefundable;
              if (
                refundVal === true ||
                refundVal === "true" ||
                refundVal === "Yes" ||
                refundVal === "نعم"
              ) {
                isRefundable = true;
              }

              if (!dedByInv[num]) dedByInv[num] = [];
              dedByInv[num].push({
                id: row.id || generateId(12),
                description: description,
                calcType: calcType,
                val: val,
                amount: parseFloat(row.amount) || 0,
                isRefundable: isRefundable,
                calcFromKeys: row.calcFromKeys
                  ? row.calcFromKeys.split(",").filter(Boolean)
                  : [],
              });
            });
            if (dedImportErrors.length) {
              alert(
                "أخطاء في ورقة الاستقطاعات:\n\n" +
                  dedImportErrors.join("\n") +
                  "\n\nتم تخطي السجلات غير الصالحة واستمرار الاستيراد.",
              );
            }
            // Convert Excel serial numbers to YYYY-MM-DD for invoice dates
            invoices.forEach((inv) => {
              inv.date = toDateOnly(inv.date);
              inv.dueDate = toDateOnly(inv.dueDate);
              inv.paymentDate = toDateOnly(inv.paymentDate);
            });
            invoices.forEach((inv) => {
              inv.items = itemsByInv[inv.number] || [];
              inv.deductions = dedByInv[inv.number] || [];
              if (!inv.items.length) delete inv.items;
              if (!inv.deductions.length) delete inv.deductions;
            });
            // Auto-calculate dueDate if missing
            invoices.forEach((inv) => {
              if (!inv.dueDate && inv.date && inv.contractId) {
                const contract = contracts.find((c) => c.id === inv.contractId);
                if (contract) {
                  const terms = parseInt(contract.paymentTerms) || 45;
                  const parts = inv.date.split("-");
                  if (parts.length === 3) {
                    const d = new Date(
                      parseInt(parts[0]),
                      parseInt(parts[1]) - 1,
                      parseInt(parts[2]) + terms,
                    );
                    inv.dueDate =
                      d.getFullYear() +
                      "-" +
                      String(d.getMonth() + 1).padStart(2, "0") +
                      "-" +
                      String(d.getDate()).padStart(2, "0");
                  }
                }
              }
            });
            state.invoices = invoices;
          }

          if (siContracts.length || siPayments.length) {
            state.socialInsurance = state.socialInsurance || {
              contracts: {},
              payments: {},
            };
            if (siContracts.length) {
              state.socialInsurance.contracts = Object.fromEntries(
                siContracts.map((row) => [
                  row.id ||
                    row.contractId ||
                    `si-${Date.now()}-${Math.random()}`,
                  row,
                ]),
              );
            }
            if (siPayments.length) {
              state.socialInsurance.payments = Object.fromEntries(
                siPayments.map((row) => [
                  row.id ||
                    row.paymentId ||
                    `sip-${Date.now()}-${Math.random()}`,
                  row,
                ]),
              );
            }
          }

          // Import deduction library
          if (deductionLibrary.length) {
            saveDeductionLibrary(
              deductionLibrary.map((d) => ({
                id: d.id || generateId(12),
                name: d.name || "",
              })),
            );
          } // Save old state for rollback on failure
          const oldState = {
            owners: state.owners,
            projects: state.projects,
            contracts: state.contracts,
            invoices: state.invoices,
            execPositions: state.execPositions,
            escalationsResponses: state.escalationsResponses,
            socialInsurance: state.socialInsurance,
            deductionLibrary: state.deductionLibrary
              ? [...state.deductionLibrary]
              : [],
          };

          // Update state so buildBootstrapPayload reads the new data
          state.owners = owners;
          state.projects = projects;
          state.contracts = contracts;
          state.invoices = invoices;
          // ... (already set above for each section)

          // Build payload from updated state
          const payload = buildBootstrapPayload();

          // NO refreshAfterImport yet — wait for backend to confirm
          try {
            await erpApi.upsertBootstrap(payload);
            // Backend confirmed save — NOW update UI
            refreshAfterImport();
            alert(
              "تم استيراد جميع البيانات من Excel وحفظها في قاعدة البيانات بنجاح",
            );
          } catch (saveErr) {
            // Backend failed — rollback state to original
            Object.assign(state, oldState);
            console.error("Backend save failed after Excel import:", saveErr);
            alert(
              "تعذر حفظ البيانات في قاعدة البيانات. يرجى التحقق من صحة بيانات الملف والمحاولة مرة أخرى.\nلم يتم تطبيق أي تغييرات.",
            );
          }
        } catch (err) {
          console.error("Full Excel import error:", err);
          alert(
            err.message === "INVALID_FULL_WORKBOOK"
              ? "الملف لا يحتوي على أوراق بيانات صالحة. يرجى استخدام القالب الصحيح."
              : "تعذر استيراد الملف. يرجى التحقق من صحة البيانات في الملف والمحاولة مرة أخرى.",
          );
        } finally {
          resetFileInput(fileImpFullExcel);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  const fileImpMasterData = document.getElementById("fileImportMasterData");
  if (fileImpMasterData) {
    fileImpMasterData.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!ensureXLSX()) {
        resetFileInput(fileImpMasterData);
        return;
      }

      const reader = new FileReader();
      reader.onload = async function (evt) {
        try {
          const wb = XLSX.read(evt.target.result, { type: "array" });
          const owners = normalizeSheetRows(wb, "Owners");
          const projects = normalizeSheetRows(wb, "Projects");
          const contracts = normalizeSheetRows(wb, "Contracts");

          if (!owners.length && !projects.length && !contracts.length) {
            throw new Error("INVALID_MASTER_WORKBOOK");
          }

          if (
            !(await erpNotify.showConfirm(
              "سيتم تحديث بيانات الملاك والمشروعات والعقود من ملف Excel. لن يتم تعديل المستخلصات أو التأمينات أو التعليات. هل تريد المتابعة؟",
              {
                title: "تأكيد استيراد البيانات الأساسية",
                confirmText: "متابعة",
                cancelText: "إلغاء",
                danger: true,
              },
            ))
          )
            return;

          // Convert Excel serial numbers to YYYY-MM-DD for date fields
          projects.forEach((p) => {
            p.startDate = toDateOnly(p.startDate);
          });
          contracts.forEach((c) => {
            c.signDate = toDateOnly(c.signDate);
            // قيمة العقد المعدل = حصر البنود (يدوي من Excel). القيم الديناميكية تبدأ 0 إن لم تُمرَّر.
            const mod = parseFloat(c.modifiedAmount);
            c.modifiedAmount = Number.isFinite(mod) && mod >= 0 ? mod : 0;
            c.voAmount = 0;
            c.claimsAmount = 0;
            c.vatAmount = 0;
          });

          // Save old state for rollback on failure
          const oldState = {
            owners: state.owners,
            projects: state.projects,
            contracts: state.contracts,
          };

          if (owners.length) state.owners = owners;
          if (projects.length) state.projects = projects;
          if (contracts.length) state.contracts = contracts;

          const payload = buildBootstrapPayload();

          try {
            await erpApi.upsertBootstrap(payload);
            refreshAfterImport();
            alert(
              "تم استيراد البيانات الأساسية وحفظها في قاعدة البيانات بنجاح",
            );
          } catch (saveErr) {
            Object.assign(state, oldState);
            console.error("Backend save failed after master import:", saveErr);
            alert(
              "تعذر حفظ البيانات في قاعدة البيانات. يرجى التحقق من صحة بيانات الملف والمحاولة مرة أخرى.\nلم يتم تطبيق أي تغييرات.",
            );
          }
        } catch (err) {
          console.error("Master Excel import error:", err);
          alert(
            err.message === "INVALID_MASTER_WORKBOOK"
              ? "الملف لا يحتوي على أوراق بيانات صالحة (الملاك، المشروعات، العقود). يرجى استخدام القالب الصحيح."
              : "تعذر استيراد البيانات. يرجى التحقق من صحة البيانات في الملف والمحاولة مرة أخرى.",
          );
        } finally {
          resetFileInput(fileImpMasterData);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }
}

// IMPORTANT: initialize only after the whole ES module has evaluated.
// This prevents temporal-dead-zone errors for constants declared later in the module.
// The legacy HTML uses inline onclick handlers. Because this file is an ES module,
// those functions are not globals automatically. Expose the handlers explicitly.
Object.assign(window, {
  editOwner,
  deleteOwner,
  openOwnerModal,
  saveOwner,

  editProject,
  deleteProject,
  openProjectModal,
  saveProject,

  editContract,
  deleteContract,
  openContractModal,
  saveContract,

  editInvoice,
  printInvoice,
  deleteInvoice,
  openInvoiceModal,
  saveInvoice,

  sortTable,
  exportTableToExcel,
  printReportSection,
  exportInvoiceToExcel,

  toggleMultiSelect,
  selectAllMs,
  updateMultiSelectLabel,
  calcInvoiceTotals,

  deleteAllOwners,
  openUserModal,
  closeUserModal,
});

function startERPWhenReady() {
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        initERP().catch((error) =>
          console.error("ERP initialization failed:", error),
        );
      },
      { once: true },
    );
  } else {
    initERP().catch((error) =>
      console.error("ERP initialization failed:", error),
    );
  }
}

startERPWhenReady();
window.deleteExecVersion = deleteExecVersion;
window.deleteLastExecVersion = deleteLastExecVersion;
/* ========================================================================
   CONTRACT COST CONTROL / BUDGET & COST CONTROL
   Contract is source of truth for values & progress. Live calculations.
   ======================================================================== */
(function () {
  let _ccData = null; // last loaded CostControlDto
  let _ccSaving = false;

  /** Safe cost-control API helpers (tolerate stale api.js cache). */
  const ccApi = {
    getByContract: (contractId) => {
      if (erpApi?.costControl?.getByContract)
        return erpApi.costControl.getByContract(contractId);
      return erpApi.request(
        `/cost-control?contractId=${encodeURIComponent(contractId)}`,
        { method: "GET" },
      );
    },
    addSubItem: (itemId, payload) => {
      if (erpApi?.costControl?.addSubItem)
        return erpApi.costControl.addSubItem(itemId, payload);
      return erpApi.request(
        `/cost-control/items/${encodeURIComponent(itemId)}/sub-items`,
        { method: "POST", body: JSON.stringify(payload) },
      );
    },
    updateSubItem: (subItemId, payload) => {
      if (erpApi?.costControl?.updateSubItem)
        return erpApi.costControl.updateSubItem(subItemId, payload);
      return erpApi.request(
        `/cost-control/sub-items/${encodeURIComponent(subItemId)}`,
        { method: "PUT", body: JSON.stringify(payload) },
      );
    },
    deleteSubItem: (subItemId) => {
      if (erpApi?.costControl?.deleteSubItem)
        return erpApi.costControl.deleteSubItem(subItemId);
      return erpApi.request(
        `/cost-control/sub-items/${encodeURIComponent(subItemId)}`,
        { method: "DELETE" },
      );
    },
    addMainItem: (costControlId, payload) => {
      if (erpApi?.costControl?.addMainItem)
        return erpApi.costControl.addMainItem(costControlId, payload);
      return erpApi.request(
        `/cost-control/${encodeURIComponent(costControlId)}/items`,
        { method: "POST", body: JSON.stringify(payload) },
      );
    },
    deleteMainItem: (itemId) => {
      if (erpApi?.costControl?.deleteMainItem)
        return erpApi.costControl.deleteMainItem(itemId);
      return erpApi.request(
        `/cost-control/items/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      );
    },
  };

  function ccFmt(n, d) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0";
    return x.toLocaleString("en-US", {
      minimumFractionDigits: d ?? 0,
      maximumFractionDigits: d ?? 2,
    });
  }

  function ccCalcLocal(sub, original, revised, progressAmount, progressPct) {
    const study = Math.max(0, parseFloat(sub.studyValue) || 0);
    const actual = Math.max(0, parseFloat(sub.actualCost) || 0);
    const orig = Number(original) || 0;
    const rev = Number(revised) || 0;
    const progAmt = Number(progressAmount) || 0;
    const progPct = Number(progressPct) || 0;
    // Tender % = Study Value ÷ Original Contract Value × 100
    const studyPct = orig > 0 ? (study / orig) * 100 : 0;
    // Tender % Revised (diagnostic only)
    const studyPctRevised = rev > 0 ? (study / rev) * 100 : 0;
    // Total Budget = Study Value
    const totalBudget = (rev * studyPct) / 100;
    // Budget To Date (monetary) = (Tender % / 100) × Progress Amount
    const budgetToDate = (studyPct / 100) * progAmt;
    // Remaining (monetary) = (Revised − Progress Amount) × (Tender % / 100)
    const remaining = studyPct > 0 ? (rev - progAmt) * (studyPct / 100) : 0;
    return {
      studyValue: study,
      actualCost: actual,
      studyPercentage: studyPct,
      studyPercentageRevised: studyPctRevised,
      totalBudget,
      budgetToDate,
      remaining,
    };
  }

  const CC_DEFAULT_CODES = new Set([
    "IND-1",
    "IND-2",
    "IND-3",
    "IND-4",
    "DIR-1",
  ]);
  function isDefaultMainItem(item) {
    const code = String(item?.code || item?.Code || "")
      .trim()
      .toUpperCase();
    return CC_DEFAULT_CODES.has(code);
  }

  function populateCcSelectors() {
    const data =
      typeof state !== "undefined" && state
        ? state
        : window.ERP_DATA || window.appData || {};
    const projects = data.projects || [];
    const contracts = data.contracts || [];
    const projSel = document.getElementById("ccProjectSelect");
    const contSel = document.getElementById("ccContractSelect");
    if (!projSel || !contSel) return;

    const prevP = projSel.value;
    const prevC = contSel.value;
    projSel.innerHTML = '<option value="">— اختر المشروع —</option>';
    projects.forEach((p) => {
      const id = p.id ?? p.Id ?? "";
      if (!id) return;
      const o = document.createElement("option");
      o.value = id;
      o.textContent = p.name ?? p.Name ?? id;
      projSel.appendChild(o);
    });
    if (prevP) projSel.value = prevP;

    function fillContracts() {
      const pid = projSel.value;
      contSel.innerHTML = '<option value="">— اختر العقد —</option>';
      contSel.disabled = !pid;
      const loadBtn = document.getElementById("ccLoadBtn");
      if (loadBtn) loadBtn.disabled = true;
      if (!pid) return;
      contracts
        .filter((c) => {
          const cPid = c.projectId ?? c.ProjectId ?? "";
          return String(cPid) === String(pid);
        })
        .forEach((c) => {
          const id = c.id ?? c.Id ?? "";
          if (!id) return;
          const o = document.createElement("option");
          o.value = id;
          o.textContent = c.name ?? c.Name ?? id;
          contSel.appendChild(o);
        });
      if (prevC) contSel.value = prevC;
      if (loadBtn) loadBtn.disabled = !contSel.value;
    }
    projSel.onchange = () => {
      _ccData = null;
      const empty = document.getElementById("ccEmptyState");
      const main = document.getElementById("ccMainArea");
      const meta = document.getElementById("ccContractMeta");
      if (empty) empty.style.display = "";
      if (main) main.style.display = "none";
      if (meta) meta.style.display = "none";
      fillContracts();
    };
    contSel.onchange = () => {
      const loadBtn = document.getElementById("ccLoadBtn");
      if (loadBtn) loadBtn.disabled = !contSel.value;
    };
    fillContracts();
  }

  function ccShowStatus(msg, isError) {
    const empty = document.getElementById("ccEmptyState");
    if (!empty) return;
    empty.style.display = "";
    const body = empty.querySelector(".card-body") || empty;
    body.innerHTML = isError
      ? `<div class="text-danger" style="padding:1rem;text-align:center"><strong>تعذر التحميل</strong><br>${msg}</div>`
      : `<div class="text-muted" style="padding:1rem;text-align:center">${msg}</div>`;
  }

  async function loadCostControl() {
    const projId = document.getElementById("ccProjectSelect")?.value || "";
    const contractId = document.getElementById("ccContractSelect")?.value || "";
    console.log("[CostControl] Load clicked", { projId, contractId });

    if (!projId) {
      ccShowStatus("برجاء اختيار المشروع أولاً", true);
      alert("برجاء اختيار المشروع أولاً");
      return;
    }
    if (!contractId) {
      ccShowStatus("برجاء اختيار العقد أولاً", true);
      alert("برجاء اختيار العقد أولاً");
      return;
    }
    const loadBtn = document.getElementById("ccLoadBtn");
    const prevLabel = loadBtn ? loadBtn.textContent : "";
    try {
      if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = "جاري تحميل بيانات العقد...";
      }
      ccShowStatus("جاري تحميل بيانات العقد...", false);

      if (!erpApi || typeof erpApi.request !== "function") {
        throw new Error("واجهة API غير متاحة. حدّث الصفحة (Ctrl+F5).");
      }

      // أول تحميل لعقد جديد أحياناً يرجع 500 من السيرفر أثناء تهيئة السجل.
      // نعيد المحاولة مرة بهدوء قبل ما نظهر تحذير للمستخدم.
      let dtoRaw = null;
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          dtoRaw = await ccApi.getByContract(contractId);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(
            `[CostControl] getByContract attempt ${attempt} failed`,
            err,
          );
          if (attempt < 2) {
            ccShowStatus("جاري تهيئة مراقبة التكاليف للعقد...", false);
            await new Promise((r) => setTimeout(r, 450));
          }
        }
      }
      if (lastErr) throw lastErr;

      console.log("[CostControl] API response", dtoRaw);
      let dto = dtoRaw;
      if (!dto) throw new Error("لم يتم إرجاع بيانات من الخادم");
      // normalize casing if server returns PascalCase
      dto = {
        id: dto.id ?? dto.Id,
        contractId: dto.contractId ?? dto.ContractId,
        projectId: dto.projectId ?? dto.ProjectId,
        contractName: dto.contractName ?? dto.ContractName,
        projectName: dto.projectName ?? dto.ProjectName,
        originalContractValue:
          dto.originalContractValue ?? dto.OriginalContractValue ?? 0,
        revisedContractValue:
          dto.revisedContractValue ?? dto.RevisedContractValue ?? 0,
        progressAmount: dto.progressAmount ?? dto.ProgressAmount ?? 0,
        progressPercentage:
          dto.progressPercentage ?? dto.ProgressPercentage ?? 0,
        items: (dto.items ?? dto.Items ?? []).map((it) => ({
          id: it.id ?? it.Id,
          costControlId: it.costControlId ?? it.CostControlId,
          name: it.name ?? it.Name,
          code: it.code ?? it.Code,
          costType: it.costType ?? it.CostType,
          displayOrder: it.displayOrder ?? it.DisplayOrder ?? 0,
          totalStudyValue: it.totalStudyValue ?? it.TotalStudyValue ?? 0,
          totalActualCost: it.totalActualCost ?? it.TotalActualCost ?? 0,
          totalBudget: it.totalBudget ?? it.TotalBudget ?? 0,
          totalBudgetToDate: it.totalBudgetToDate ?? it.TotalBudgetToDate ?? 0,
          totalRemaining: it.totalRemaining ?? it.TotalRemaining ?? 0,
          subItems: (it.subItems ?? it.SubItems ?? []).map((s) => ({
            id: s.id ?? s.Id,
            costControlItemId: s.costControlItemId ?? s.CostControlItemId,
            description: s.description ?? s.Description ?? "",
            studyValue: s.studyValue ?? s.StudyValue ?? 0,
            actualCost: s.actualCost ?? s.ActualCost ?? 0,
            displayOrder: s.displayOrder ?? s.DisplayOrder ?? 0,
            studyPercentage: s.studyPercentage ?? s.StudyPercentage ?? 0,
            budgetToDate: s.budgetToDate ?? s.BudgetToDate ?? 0,
            totalBudget: s.totalBudget ?? s.TotalBudget ?? 0,
            remaining: s.remaining ?? s.Remaining ?? 0,
          })),
        })),
        summary: (() => {
          const s = dto.summary ?? dto.Summary ?? {};
          return {
            originalContractValue:
              s.originalContractValue ?? s.OriginalContractValue ?? 0,
            revisedContractValue:
              s.revisedContractValue ?? s.RevisedContractValue ?? 0,
            progressAmount: s.progressAmount ?? s.ProgressAmount ?? 0,
            progressPercentage:
              s.progressPercentage ?? s.ProgressPercentage ?? 0,
            remainingContractValue:
              s.remainingContractValue ?? s.RemainingContractValue ?? 0,
            totalIndirectBudget:
              s.totalIndirectBudget ?? s.TotalIndirectBudget ?? 0,
            totalDirectBudget: s.totalDirectBudget ?? s.TotalDirectBudget ?? 0,
            totalBudget: s.totalBudget ?? s.TotalBudget ?? 0,
            actualIndirect: s.actualIndirect ?? s.ActualIndirect ?? 0,
            actualDirect: s.actualDirect ?? s.ActualDirect ?? 0,
            totalActualCost: s.totalActualCost ?? s.TotalActualCost ?? 0,
            ctcIndirect: s.ctcIndirect ?? s.CtcIndirect ?? 0,
            ctcDirect: s.ctcDirect ?? s.CtcDirect ?? 0,
            totalCtc: s.totalCtc ?? s.TotalCtc ?? 0,
            eacIndirect: s.eacIndirect ?? s.EacIndirect ?? 0,
            eacDirect: s.eacDirect ?? s.EacDirect ?? 0,
            totalEac: s.totalEac ?? s.TotalEac ?? 0,
            profit: s.profit ?? s.Profit ?? 0,
          };
        })(),
        createdAt: dto.createdAt ?? dto.CreatedAt,
        updatedAt: dto.updatedAt ?? dto.UpdatedAt,
      };
      _ccData = dto;
      renderCostControl(dto);
      if (!(dto.items && dto.items.length)) {
        const container = document.getElementById("ccItemsContainer");
        if (container && !container.children.length) {
          container.innerHTML =
            '<div class="card"><div class="card-body text-center text-muted">لا توجد بيانات تكلفة لهذا العقد</div></div>';
        }
      }
    } catch (e) {
      console.error("[CostControl] Load failed", e);
      const status = e && (e.status || e.statusCode);
      const rawMsg =
        e && (e.message || e.status)
          ? String(e.message || e.status)
          : String(e);
      // 500 عند أول تحميل غالباً تهيئة السجل على السيرفر — رسالة أوضح بدون تهويل
      const msg =
        status === 500 || /غير متوقع|Internal|500/i.test(rawMsg)
          ? "تعذّر تهيئة مراقبة التكاليف لهذا العقد من السيرفر. حاول التحميل مرة أخرى خلال ثوانٍ."
          : rawMsg;
      ccShowStatus(msg, true);
      // لا نقطع تجربة المستخدم بتنبيه حاد إذا الرسالة عامة؛ نعرض الحالة في الواجهة
      if (status && status !== 500) {
        alert("فشل تحميل مراقبة التكاليف: " + msg);
      }
    } finally {
      if (loadBtn) {
        loadBtn.textContent = prevLabel || "تحميل";
        const contSel = document.getElementById("ccContractSelect");
        loadBtn.disabled = !(contSel && contSel.value);
      }
    }
  }

  function renderCostControl(dto) {
    document.getElementById("ccEmptyState").style.display = "none";
    document.getElementById("ccContractMeta").style.display = "";
    document.getElementById("ccMainArea").style.display = "";

    document.getElementById("ccOriginalValue").textContent = ccFmt(
      dto.originalContractValue,
    );
    document.getElementById("ccRevisedValue").textContent = ccFmt(
      dto.revisedContractValue,
    );
    document.getElementById("ccProgressAmount").textContent = ccFmt(
      dto.progressAmount,
    );
    document.getElementById("ccProgressPct").textContent =
      ccFmt(dto.progressPercentage, 2) + " %";

    const container = document.getElementById("ccItemsContainer");
    container.innerHTML = "";
    const revised = dto.revisedContractValue || 0;
    const original = dto.originalContractValue || 0;
    const progressPct = dto.progressPercentage || 0;
    const progressAmount = dto.progressAmount || 0;

    (dto.items || []).forEach((item) => {
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "1rem";
      card.dataset.itemId = item.id;
      card.dataset.costType = (item.costType || "INDIRECT").toUpperCase();

      const typeBadge =
        (item.costType || "").toUpperCase() === "DIRECT"
          ? '<span class="badge" style="background:#2563eb;color:#fff;margin-inline-start:0.5rem">مباشر</span>'
          : '<span class="badge" style="background:#64748b;color:#fff;margin-inline-start:0.5rem">غير مباشر</span>';

      let rowsHtml = "";
      const subs = item.subItems || [];
      if (subs.length === 0) {
        rowsHtml = `<tr><td colspan="8" class="text-center text-muted">لا توجد بنود مضافة</td></tr>`;
      } else {
        subs.forEach((s) => {
          const calc = ccCalcLocal(
            s,
            original,
            revised,
            progressAmount,
            progressPct,
          );
          rowsHtml += `
                    <tr data-sub-id="${s.id}">
                        <td><input type="text" class="form-control form-control-sm cc-desc" value="${(s.description || "").replace(/"/g, "&quot;")}" /></td>
                        <td><input type="number" min="0" step="0.01" class="form-control form-control-sm cc-study" value="${calc.studyValue}" /></td>
                        <td class="cc-study-pct text-muted">${ccFmt(calc.studyPercentage, 2)}%</td>
                        <td class="cc-budget-to-date text-muted">${ccFmt(calc.budgetToDate, 2)}</td>
                        <td class="cc-total-budget text-muted">${ccFmt(calc.totalBudget)}</td>
                        <td><input type="number" min="0" step="0.01" class="form-control form-control-sm cc-actual" value="${calc.actualCost}" /></td>
                        <td class="cc-remaining text-muted">${ccFmt(calc.remaining)}</td>
                        <td>
                            <button type="button" class="btn btn-sm btn-outline-danger cc-del-sub" title="حذف">×</button>
                        </td>
                    </tr>`;
        });
      }

      const isDefault = isDefaultMainItem(item);
      const delMainBtn = isDefault
        ? ""
        : `<button type="button" class="btn btn-sm btn-outline-danger cc-del-main" title="حذف البند الأساسي">حذف</button>`;
      card.innerHTML = `
                <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem">
                    <div><strong>${item.name || ""}</strong> ${typeBadge}</div>
                    <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                        <button type="button" class="btn btn-sm btn-primary cc-add-sub">+ إضافة بند</button>
                        ${delMainBtn}
                    </div>
                </div>
                <div class="card-body" style="overflow-x:auto">
                    ${
                      subs.length === 0
                        ? `<div class="text-center text-muted" style="padding:1rem 0.5rem">لا توجد بنود مضافة</div>`
                        : `<table class="table table-sm table-bordered cc-sub-table" style="min-width:900px">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Tender Value </th>
                                <th> Tender %</th>
                                <th> Budget To Date </th>
                                <th>Total Budget </th>
                                <th>Total Actual Cost </th>
                                <th>Budget Of Remaining</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                        <tfoot>
                            <tr>
                                <th>إجمالي البند الرئيسي</th>
                                <th class="cc-item-total-study">0</th>
                                <th></th>
                                <th class="cc-item-total-btd">0</th>
                                <th class="cc-item-total-budget">0</th>
                                <th class="cc-item-total-actual">0</th>
                                <th class="cc-item-total-remaining">0</th>
                                <th></th>
                            </tr>
                        </tfoot>
                    </table>`
                    }
                </div>`;
      container.appendChild(card);

      // Wire events
      card
        .querySelector(".cc-add-sub")
        ?.addEventListener("click", () =>
          openAddSubItemForm(item.id, item.name || ""),
        );
      card
        .querySelector(".cc-del-main")
        ?.addEventListener("click", () =>
          deleteMainItem(item.id, item.name || ""),
        );
      card
        .querySelectorAll("tbody tr[data-sub-id]")
        .forEach((tr) =>
          wireSubRow(
            tr,
            item.id,
            original,
            revised,
            progressAmount,
            progressPct,
          ),
        );
      // Always recompute item totals from live sub-item cells (never trust stale DTO totals)
      recalcItemTotals(card);
    });

    // ===== إجمالي كل البنود (بعد كل البنود الرئيسية) =====
    let grand = document.getElementById("ccGrandTotalCard");
    if (grand) grand.remove();
    grand = document.createElement("div");
    grand.className = "card";
    grand.id = "ccGrandTotalCard";
    grand.style.cssText =
      "margin:1rem 0 1.5rem;border:2px solid #1e3a5f;box-shadow:0 4px 14px rgba(30,58,95,.15);";
    grand.innerHTML = `
            <div class="card-header" style="background:#1e3a5f;color:#fff;padding:0.65rem 1rem;font-weight:700">
                إجمالي كل البنود / Grand Total (All Items)
            </div>
            <div class="card-body" style="padding:0;overflow-x:auto">
                <table class="table table-sm table-bordered cc-sub-table" style="min-width:900px;margin:0;width:100%;table-layout:fixed">
                    <colgroup>
                        <col style="width:18%">
                        <col style="width:14%">
                        <col style="width:10%">
                        <col style="width:14%">
                        <col style="width:14%">
                        <col style="width:14%">
                        <col style="width:14%">
                        <col style="width:2%">
                    </colgroup>
                    <thead>
                        <tr style="background:#e2e8f0">
                            <th style="text-align:center">Item</th>
                            <th style="text-align:center">Tender Value</th>
                            <th style="text-align:center">% Tender</th>
                            <th style="text-align:center">Budget To Date</th>
                            <th style="text-align:center">Total Budget</th>
                            <th style="text-align:center">Total Actual Cost</th>
                            <th style="text-align:center">Budget Of Remaining</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="background:#f0f7ff;font-weight:700">
                            <td style="text-align:center">الإجمالي الكلي</td>
                            <td class="cc-grand-total-study" style="text-align:center">0</td>
                            <td class="cc-grand-total-pct" style="text-align:center">—</td>
                            <td class="cc-grand-total-btd" style="text-align:center">0</td>
                            <td class="cc-grand-total-budget" style="text-align:center">0</td>
                            <td class="cc-grand-total-actual" style="text-align:center">0</td>
                            <td class="cc-grand-total-remaining" style="text-align:center">0</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </div>`;
    container.appendChild(grand);
    recalcGrandTotals();

    // Rebuild summary from DOM so Total Remaining / CTC match new Remaining formula
    recalcSummaryFromDom();
  }

  function wireSubRow(
    tr,
    itemId,
    original,
    revised,
    progressAmount,
    progressPct,
  ) {
    const subId = tr.dataset.subId;
    const studyInp = tr.querySelector(".cc-study");
    const actualInp = tr.querySelector(".cc-actual");
    const descInp = tr.querySelector(".cc-desc");

    const recalc = () => {
      const calc = ccCalcLocal(
        {
          studyValue: studyInp.value,
          actualCost: actualInp.value,
        },
        original,
        revised,
        progressAmount,
        progressPct,
      );
      tr.querySelector(".cc-study-pct").textContent =
        ccFmt(calc.studyPercentage, 2) + "%";
      tr.querySelector(".cc-budget-to-date").textContent = ccFmt(
        calc.budgetToDate,
        2,
      );
      tr.querySelector(".cc-total-budget").textContent = ccFmt(
        calc.totalBudget,
      );
      tr.querySelector(".cc-remaining").textContent = ccFmt(calc.remaining);
      recalcItemTotals(tr.closest(".card"));
      recalcSummaryFromDom();
    };

    let timer = null;
    const persist = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (_ccSaving) return;
        _ccSaving = true;
        try {
          const updated = await ccApi.updateSubItem(subId, {
            description: descInp.value || "بند",
            studyValue: Math.max(0, parseFloat(studyInp.value) || 0),
            actualCost: Math.max(0, parseFloat(actualInp.value) || 0),
          });
          // keep local
          if (_ccData) {
            for (const it of _ccData.items || []) {
              const s = (it.subItems || []).find((x) => x.id === subId);
              if (s) {
                s.description = updated.description;
                s.studyValue = updated.studyValue;
                s.actualCost = updated.actualCost;
                s.studyPercentage = updated.studyPercentage;
                s.budgetToDate = updated.budgetToDate;
                s.totalBudget = updated.totalBudget;
                s.remaining = updated.remaining;
              }
            }
          }
        } catch (e) {
          console.error(e);
        } finally {
          _ccSaving = false;
        }
      }, 400);
    };

    studyInp?.addEventListener("input", () => {
      recalc();
      persist();
    });
    actualInp?.addEventListener("input", () => {
      recalc();
      persist();
    });
    descInp?.addEventListener("change", persist);

    tr.querySelector(".cc-del-sub")?.addEventListener("click", async () => {
      const ok =
        typeof erpNotify !== "undefined" && erpNotify.showConfirm
          ? await erpNotify.showConfirm("هل تريد حذف هذا البند الفرعي؟", {
              title: "تأكيد الحذف",
              confirmText: "حذف",
              cancelText: "إلغاء",
              danger: true,
            })
          : confirm("هل تريد حذف هذا البند؟");
      if (!ok) return;
      try {
        await ccApi.deleteSubItem(subId);
        await loadCostControl();
      } catch (e) {
        alert("فشل الحذف: " + (e.message || ""));
      }
    });
  }

  function recalcItemTotals(card) {
    if (!card) return;
    let study = 0,
      btd = 0,
      budget = 0,
      actual = 0,
      remaining = 0;
    const parseCell = (el) => {
      const raw = String(el?.textContent || "")
        .replace(/,/g, "")
        .replace(/%/g, "")
        .trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : 0;
    };
    card.querySelectorAll("tbody tr[data-sub-id]").forEach((tr) => {
      study += parseFloat(tr.querySelector(".cc-study")?.value) || 0;
      btd += parseCell(tr.querySelector(".cc-budget-to-date"));
      budget += parseCell(tr.querySelector(".cc-total-budget"));
      actual += parseFloat(tr.querySelector(".cc-actual")?.value) || 0;
      remaining += parseCell(tr.querySelector(".cc-remaining"));
    });
    // No sub-items => all totals are 0 (never show stale DTO values)
    const set = (sel, v, isPct) => {
      const el = card.querySelector(sel);
      if (!el) return;
      el.textContent = isPct ? ccFmt(v, 2) + "%" : ccFmt(v);
    };
    set(".cc-item-total-study", study, false);
    set(".cc-item-total-btd", btd, false);
    set(".cc-item-total-budget", budget, false);
    set(".cc-item-total-actual", actual, false);
    set(".cc-item-total-remaining", remaining, false);
    recalcGrandTotals();
  }

  function recalcGrandTotals() {
    const grand = document.getElementById("ccGrandTotalCard");
    if (!grand) return;
    let study = 0,
      btd = 0,
      budget = 0,
      actual = 0,
      remaining = 0;
    const parseTot = (sel, card) => {
      const raw = String(card.querySelector(sel)?.textContent || "")
        .replace(/,/g, "")
        .replace(/%/g, "")
        .trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : 0;
    };
    document
      .querySelectorAll("#ccItemsContainer .card:not(#ccGrandTotalCard)")
      .forEach((card) => {
        study += parseTot(".cc-item-total-study", card);
        btd += parseTot(".cc-item-total-btd", card);
        budget += parseTot(".cc-item-total-budget", card);
        actual += parseTot(".cc-item-total-actual", card);
        remaining += parseTot(".cc-item-total-remaining", card);
      });
    const set = (sel, v, isText) => {
      const el = grand.querySelector(sel);
      if (!el) return;
      el.textContent = isText ? v : ccFmt(v);
    };
    const original = Number(_ccData?.originalContractValue) || 0;
    const pct = original > 0 ? (study / original) * 100 : 0;
    set(".cc-grand-total-study", study);
    set(".cc-grand-total-pct", ccFmt(pct, 2) + "%", true);
    set(".cc-grand-total-btd", btd);
    set(".cc-grand-total-budget", budget);
    set(".cc-grand-total-actual", actual);
    set(".cc-grand-total-remaining", remaining);
  }

  function recalcSummaryFromDom() {
    // Lightweight: reload summary numbers from current cards by cost type badge
    if (!_ccData) return;
    let indBudget = 0,
      dirBudget = 0,
      indActual = 0,
      dirActual = 0,
      indRem = 0,
      dirRem = 0;
    const parseTot = (sel, card) => {
      const raw = String(card.querySelector(sel)?.textContent || "")
        .replace(/,/g, "")
        .replace(/%/g, "")
        .trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : 0;
    };
    document.querySelectorAll("#ccItemsContainer .card").forEach((card) => {
      const isDirect = (card.dataset.costType || "").toUpperCase() === "DIRECT";
      const budget = parseTot(".cc-item-total-budget", card);
      const actual = parseTot(".cc-item-total-actual", card);
      const rem = parseTot(".cc-item-total-remaining", card);
      if (isDirect) {
        dirBudget += budget;
        dirActual += actual;
        dirRem += rem;
      } else {
        indBudget += budget;
        indActual += actual;
        indRem += rem;
      }
    });
    const revised = _ccData.revisedContractValue || 0;
    const progressAmount = _ccData.progressAmount || 0;
    const totalBudget = indBudget + dirBudget;
    const totalActual = indActual + dirActual;
    const totalCtc = indRem + dirRem;
    const eacInd = indActual + indRem;
    const eacDir = dirActual + dirRem;
    const totalEac = eacInd + eacDir;
    renderCcSummary({
      originalContractValue: _ccData.originalContractValue,
      revisedContractValue: revised,
      progressAmount,
      progressPercentage: _ccData.progressPercentage,
      remainingContractValue: revised - progressAmount,
      totalIndirectBudget: indBudget,
      totalDirectBudget: dirBudget,
      totalBudget,
      actualIndirect: indActual,
      actualDirect: dirActual,
      totalActualCost: totalActual,
      ctcIndirect: indRem,
      ctcDirect: dirRem,
      totalCtc,
      eacIndirect: eacInd,
      eacDirect: eacDir,
      totalEac,
      profit: revised - totalEac,
    });
  }

  function renderCcSummary(s) {
    if (!s) return;
    const wrap =
      document.getElementById("ccSummaryWrap") ||
      document.getElementById("ccSummaryGrid")?.parentElement;
    const grid = document.getElementById("ccSummaryGrid");
    if (!grid) return;

    // Toolbar for print / excel (once)
    let toolbar = document.getElementById("ccSummaryToolbar");
    if (!toolbar && wrap) {
      toolbar = document.createElement("div");
      toolbar.id = "ccSummaryToolbar";
      toolbar.className = "cc-summary-toolbar no-print";
      toolbar.style.cssText =
        "display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem;justify-content:flex-end";
      toolbar.innerHTML = `
                <button type="button" class="btn btn-sm btn-outline-secondary" id="ccPrintSummaryBtn">🖨 Print Summary</button>
                <button type="button" class="btn btn-sm btn-outline-primary" id="ccExportSummaryBtn">📥 Export Excel</button>`;
      wrap.insertBefore(toolbar, grid);
      document
        .getElementById("ccPrintSummaryBtn")
        ?.addEventListener("click", printCcSummary);
      document
        .getElementById("ccExportSummaryBtn")
        ?.addEventListener("click", exportCcSummaryExcel);
    }

    const rows = [
      ["Revised Contract Value", s.revisedContractValue, false],
      ["Progress ", s.progressAmount, false],
      ["Remaining Contract Value", s.remainingContractValue, false],
      ["Total Indirect Budget", s.totalIndirectBudget, false],
      ["Total Direct Budget", s.totalDirectBudget, false],
      ["Total Budget", s.totalBudget, false],
      ["Actual Indirect Cost", s.actualIndirect, false],
      ["Actual Direct Cost", s.actualDirect, false],
      ["Total Actual Cost", s.totalActualCost, false],
      ["Indirect Cost to Complete (CTC)", s.ctcIndirect, false],
      ["Direct Cost to Complete (CTC)", s.ctcDirect, false],
      ["Total Cost to Complete (CTC)", s.totalCtc, false],
      ["Indirect Estimate at Completion (EAC)", s.eacIndirect, false],
      ["Direct Estimate at Completion (EAC)", s.eacDirect, false],
      ["Total Estimate at Completion (EAC)", s.totalEac, false],
      ["Profit", s.profit, false],
    ];

    grid.innerHTML = `
            <div class="cc-summary-print-header" style="display:none;margin-bottom:1rem;text-align:center">
                <h2 style="margin:0 0 0.25rem">Summary</h2>
                <div class="text-muted" style="font-size:0.9rem">${(_ccData && (_ccData.contractName || "")) || ""}</div>
            </div>
            <style>
              #ccSummaryGrid .cc-summary-table tbody tr,
              #ccSummaryGrid .cc-summary-table tbody tr:hover,
              #ccSummaryGrid .cc-summary-table tbody tr td,
              #ccSummaryGrid .cc-summary-table tbody tr:hover td {
                background-color: inherit !important;
              }
              #ccSummaryGrid .cc-summary-table tbody tr[data-row-bg],
              #ccSummaryGrid .cc-summary-table tbody tr[data-row-bg]:hover,
              #ccSummaryGrid .cc-summary-table tbody tr[data-row-bg] td,
              #ccSummaryGrid .cc-summary-table tbody tr[data-row-bg]:hover td {
                background-color: attr(data-row-bg) !important;
              }
            </style>
            <table class="cc-summary-table table table-bordered" style="width:100%;border-collapse:collapse;direction:ltr">
                <thead>
                    <tr style="background:#1e3a5f;color:#fff">
                        <th style="padding:0.65rem 0.85rem;text-align:left;width:60%">ITEM</th>
                        <th style="padding:0.65rem 0.85rem;text-align:right;width:40%">VALUE</th>
                    </tr>
                </thead>
                <tbody>
                  ${rows
                    .map(([label, val, isPct], idx) => {
                      const isNegProfit = label === "Profit" && Number(val) < 0;
                      const rowBg =
                        label === "Remaining Contract Value"
                          ? "#C6E0B3"
                          : label === "Total Budget"
                            ? "#FFE699"
                            : label === "Total Actual Cost"
                              ? "#C9C9C9"
                              : label === "Total Cost to Complete (CTC)"
                                ? "#F8CBAD"
                                : label === "Total Estimate at Completion (EAC)"
                                  ? "#BDD7EE"
                                  : idx % 2 === 0
                                    ? "#fff"
                                    : "#f8fafc";
                      return `
                <tr style="background:${rowBg} !important" onmouseover="this.style.background='${rowBg}'" onmouseout="this.style.background='${rowBg}'">
                    <td style="padding:0.55rem 0.85rem;border:1px solid #e2e8f0;font-weight:500;text-align:left;background:${rowBg} !important">${label}</td>
                    <td style="padding:0.55rem 0.85rem;border:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;direction:ltr;background:${rowBg} !important;${isNegProfit ? "color:#dc3545;font-weight:600;" : ""}">${ccFmt(val, 2)}${isPct ? " %" : ""}</td>
                </tr>`;
                    })
                    .join("")}
                </tbody>
            </table>`;
    grid.style.display = "block";
    grid.dataset.summaryJson = JSON.stringify(
      rows.map(([label, val, isPct]) => ({ label, val, isPct })),
    );
  }

  function printCcSummary() {
    const grid = document.getElementById("ccSummaryGrid");
    if (!grid) {
      alert("No summary data to print");
      return;
    }
    const table = grid.querySelector(".cc-summary-table");
    if (!table) {
      alert("Summary table is not ready to print");
      return;
    }
    const contractName =
      (_ccData && (_ccData.contractName || _ccData.projectName || "")) || "";
    const projectName = (_ccData && (_ccData.projectName || "")) || "";
    const title = "Summary";
    const meta = [projectName, contractName].filter(Boolean).join(" — ");
    const tableHtml = table.outerHTML;
    const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    color: #0f172a;
    margin: 0;
    padding: 0;
    direction: ltr;
  }
  .print-header {
    text-align: center;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 2px solid #1e3a5f;
  }
  .print-header h1 {
    margin: 0 0 6px;
    font-size: 18pt;
    color: #1e3a5f;
  }
  .print-header .meta {
    font-size: 11pt;
    color: #475569;
  }
  .print-header .date {
    font-size: 9pt;
    color: #64748b;
    margin-top: 4px;
  }
  table.cc-summary-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
    page-break-inside: avoid;
  }
  table.cc-summary-table thead tr {
    background: #1e3a5f !important;
    color: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  table.cc-summary-table th,
  table.cc-summary-table td {
    border: 1px solid #cbd5e1;
    padding: 7px 10px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  table.cc-summary-table th {
    text-align: left;
    font-weight: 700;
  }
  table.cc-summary-table td:last-child {
    text-align: right;
    direction: ltr;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  table.cc-summary-table tbody tr:nth-child(even) {
    background: #f8fafc !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* ألوان الصفوف المطلوبة */
  table.cc-summary-table tbody tr td {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .print-footer {
    margin-top: 16px;
    font-size: 8pt;
    color: #94a3b8;
    text-align: center;
  }
</style>
<body>
  <div class="print-header">
    <h1>${title}</h1>
    ${meta ? `<div class="meta">${meta}</div>` : ""}
    <div class="date">${new Date().toLocaleDateString("ar-EG")} — Invoices ERP</div>
  </div>
  ${tableHtml}
  <div class="print-footer">Page 1 — Summary</div>
  <script>
    window.onload = function () {
      setTimeout(function () { window.focus(); window.print(); }, 200);
    };
  </script>
</body>
</html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      alert("Please allow pop-ups for printing");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function exportCcSummaryExcel() {
    const grid = document.getElementById("ccSummaryGrid");
    if (!grid || !grid.dataset.summaryJson) {
      alert("No summary data to export");
      return;
    }
    let rows;
    try {
      rows = JSON.parse(grid.dataset.summaryJson);
    } catch {
      rows = [];
    }
    if (!rows.length) return;
    if (typeof XLSX === "undefined") {
      alert("Excel library is not available. Please refresh the page.");
      return;
    }
    const data = [["Item", "Value"]].concat(
      rows.map((r) => [
        r.label,
        r.isPct ? (Number(r.val) || 0) / 100 : Number(r.val) || 0,
      ]),
    );
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 40 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
    const name =
      (_ccData && (_ccData.contractName || _ccData.contractId)) || "summary";
    XLSX.writeFile(wb, `Summary_${name}.xlsx`);
  }

  function ensureCcModal() {
    let modal = document.getElementById("ccItemFormModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "ccItemFormModal";
    modal.className = "modal-overlay";
    modal.style.display = "none";
    modal.innerHTML = `
            <div class="modal-dialog" style="max-width:480px;width:95%">
                <div class="modal-content" style="border-radius:10px;overflow:hidden">
                    <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;border-bottom:1px solid var(--border,#e2e8f0)">
                        <h3 id="ccItemFormTitle" style="margin:0;font-size:1.1rem">إضافة بند</h3>
                        <button type="button" class="btn btn-sm btn-outline-secondary" id="ccItemFormClose" aria-label="إغلاق">×</button>
                    </div>
                    <div class="modal-body" style="padding:1.25rem">
                        <div id="ccItemFormError" class="text-danger" style="display:none;margin-bottom:0.75rem;font-size:0.9rem"></div>
                        <div class="form-group" style="margin-bottom:0.85rem">
                            <label for="ccItemFormName">Sub-Item<span class="text-danger">*</span></label>
                            <input type="text" id="ccItemFormName" class="form-control" placeholder="أدخل وصف البند" maxlength="200" />
                        </div>
                        <div class="form-group" id="ccItemFormStudyGroup" style="margin-bottom:0.85rem">
                            <label for="ccItemFormStudy">قيمة الدراسة</label>
                            <input type="number" id="ccItemFormStudy" class="form-control" min="0" step="0.01" value="0" />
                        </div>
                        <div class="form-group" id="ccItemFormActualGroup" style="margin-bottom:0.85rem">
                            <label for="ccItemFormActual">التكلفة الفعلية</label>
                            <input type="number" id="ccItemFormActual" class="form-control" min="0" step="0.01" value="0" />
                        </div>
                        <div class="form-group" id="ccItemFormTypeGroup" style="margin-bottom:0.85rem;display:none">
                            <label for="ccItemFormType">نوع التكلفة</label>
                            <select id="ccItemFormType" class="form-control">
                                <option value="INDIRECT">غير مباشر</option>
                                <option value="DIRECT">مباشر</option>
                            </select>
                        </div>
                        <div class="form-group" id="ccItemFormCodeGroup" style="margin-bottom:0.85rem;display:none">
                            <label for="ccItemFormCode">الكود (اختياري)</label>
                            <input type="text" id="ccItemFormCode" class="form-control" maxlength="40" />
                        </div>
                    </div>
                    <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:0.5rem;padding:1rem 1.25rem;border-top:1px solid var(--border,#e2e8f0)">
                        <button type="button" class="btn btn-secondary" id="ccItemFormCancel">إلغاء</button>
                        <button type="button" class="btn btn-primary" id="ccItemFormSubmit">حفظ</button>
                    </div>
                </div>
            </div>`;
    document.body.appendChild(modal);
    const close = () => {
      modal.style.display = "none";
    };
    modal.querySelector("#ccItemFormClose").addEventListener("click", close);
    modal.querySelector("#ccItemFormCancel").addEventListener("click", close);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
    return modal;
  }

  async function deleteMainItem(itemId, itemName) {
    if (!itemId) return;
    const label = itemName || "هذا البند الأساسي";
    const ok =
      typeof erpNotify !== "undefined" && erpNotify.showConfirm
        ? await erpNotify.showConfirm(
            `هل تريد حذف البند الأساسي «${label}»؟\nسيتم حذف جميع البنود الفرعية التابعة له.`,
            {
              title: "تأكيد الحذف",
              confirmText: "حذف",
              cancelText: "إلغاء",
              danger: true,
            },
          )
        : confirm(
            `هل تريد حذف البند الأساسي «${label}»؟\nسيتم حذف جميع البنود الفرعية التابعة له.`,
          );
    if (!ok) return;
    try {
      await ccApi.deleteMainItem(itemId);
      await loadCostControl();
    } catch (e) {
      if (typeof erpNotify !== "undefined" && erpNotify.showError) {
        erpNotify.showError("فشل حذف البند: " + (e.message || "حدث خطأ"));
      } else {
        alert("فشل حذف البند: " + (e.message || "حدث خطأ"));
      }
    }
  }

  function openAddSubItemForm(itemId, itemName) {
    const modal = ensureCcModal();
    modal.dataset.mode = "sub";
    modal.dataset.itemId = itemId;
    document.getElementById("ccItemFormTitle").textContent =
      "إضافة بند" + (itemName ? " — " + itemName : "");
    document.getElementById("ccItemFormError").style.display = "none";
    document.getElementById("ccItemFormName").value = "";
    document.getElementById("ccItemFormStudy").value = "0";
    document.getElementById("ccItemFormActual").value = "0";
    document.getElementById("ccItemFormStudyGroup").style.display = "";
    document.getElementById("ccItemFormActualGroup").style.display = "";
    document.getElementById("ccItemFormTypeGroup").style.display = "none";
    document.getElementById("ccItemFormCodeGroup").style.display = "none";
    modal.style.display = "flex";
    setTimeout(() => document.getElementById("ccItemFormName").focus(), 50);
    const submit = document.getElementById("ccItemFormSubmit");
    submit.onclick = async () => {
      const name = (
        document.getElementById("ccItemFormName").value || ""
      ).trim();
      const err = document.getElementById("ccItemFormError");
      if (!name) {
        err.textContent = "الوصف مطلوب";
        err.style.display = "";
        return;
      }
      const study = Math.max(
        0,
        parseFloat(document.getElementById("ccItemFormStudy").value) || 0,
      );
      const actual = Math.max(
        0,
        parseFloat(document.getElementById("ccItemFormActual").value) || 0,
      );
      submit.disabled = true;
      try {
        await ccApi.addSubItem(itemId, {
          description: name,
          studyValue: study,
          actualCost: actual,
        });
        modal.style.display = "none";
        await loadCostControl();
      } catch (e) {
        err.textContent = "فشل إضافة البند: " + (e.message || "حدث خطأ");
        err.style.display = "";
      } finally {
        submit.disabled = false;
      }
    };
  }

  function openAddMainItemForm() {
    if (!_ccData || !_ccData.id) {
      alert("برجاء تحميل العقد أولاً");
      return;
    }
    const modal = ensureCcModal();
    modal.dataset.mode = "main";
    document.getElementById("ccItemFormTitle").textContent = "إضافة بند أساسي";
    document.getElementById("ccItemFormError").style.display = "none";
    document.getElementById("ccItemFormName").value = "";
    document.getElementById("ccItemFormCode").value = "";
    document.getElementById("ccItemFormType").value = "INDIRECT";
    document.getElementById("ccItemFormStudyGroup").style.display = "none";
    document.getElementById("ccItemFormActualGroup").style.display = "none";
    document.getElementById("ccItemFormTypeGroup").style.display = "";
    document.getElementById("ccItemFormCodeGroup").style.display = "";
    modal.style.display = "flex";
    setTimeout(() => document.getElementById("ccItemFormName").focus(), 50);
    const submit = document.getElementById("ccItemFormSubmit");
    submit.onclick = async () => {
      const name = (
        document.getElementById("ccItemFormName").value || ""
      ).trim();
      const err = document.getElementById("ccItemFormError");
      if (!name) {
        err.textContent = "اسم البند الأساسي مطلوب";
        err.style.display = "";
        return;
      }
      const costType =
        document.getElementById("ccItemFormType").value || "INDIRECT";
      const code = (
        document.getElementById("ccItemFormCode").value || ""
      ).trim();
      submit.disabled = true;
      try {
        await ccApi.addMainItem(_ccData.id, {
          name,
          code: code || null,
          costType,
          displayOrder: 0,
        });
        modal.style.display = "none";
        await loadCostControl();
      } catch (e) {
        err.textContent =
          "فشل إضافة البند الأساسي: " + (e.message || "حدث خطأ");
        err.style.display = "";
      } finally {
        submit.disabled = false;
      }
    };
  }

  // legacy no-op (تمت إزالة "إضافة قيمة")
  async function addStudyValue() {
    /* removed */
  }

  function initCostControlPage() {
    populateCcSelectors();
    // Bind Load button every time (safe even if DOM was re-rendered)
    const loadBtn = document.getElementById("ccLoadBtn");
    if (loadBtn) {
      loadBtn.onclick = function (ev) {
        ev.preventDefault();
        loadCostControl();
      };
    }
    const addMainBtn = document.getElementById("ccAddMainItemBtn");
    if (addMainBtn) {
      addMainBtn.onclick = function (ev) {
        ev.preventDefault();
        openAddMainItemForm();
      };
    }
    // إخفاء شريط الفلاتر العام في صفحة مراقبة التكلفة فقط
    const filterBar = document.getElementById("global-filters-bar");
    if (filterBar) filterBar.style.display = "none";

    if (!_ccData) {
      const empty = document.getElementById("ccEmptyState");
      const main = document.getElementById("ccMainArea");
      const meta = document.getElementById("ccContractMeta");
      if (empty) empty.style.display = "";
      if (main) main.style.display = "none";
      if (meta) meta.style.display = "none";
    }
  }

  // Event delegation — works even if button is replaced
  document.addEventListener("click", (e) => {
    const link = e.target.closest('.sidebar-link[data-page="costControlView"]');
    if (link) {
      setTimeout(initCostControlPage, 50);
      return;
    }
    const btn = e.target.closest("#ccLoadBtn");
    if (btn) {
      e.preventDefault();
      loadCostControl();
    }
  });

  // Refresh selectors when bootstrap data arrives (once, not on every style change)
  let _ccSelectorsTimer = null;
  const _obs = new MutationObserver(() => {
    if (
      !document.getElementById("costControlView")?.classList.contains("active")
    )
      return;
    clearTimeout(_ccSelectorsTimer);
    _ccSelectorsTimer = setTimeout(() => {
      if (!_ccData) populateCcSelectors();
    }, 200);
  });
  if (document.getElementById("content-area")) {
    _obs.observe(document.getElementById("content-area"), {
      attributes: true,
      subtree: true,
      attributeFilter: ["class"],
    });
  }

  // Init immediately if page already active
  if (
    document.getElementById("costControlView")?.classList.contains("active")
  ) {
    setTimeout(initCostControlPage, 0);
  }

  window.initCostControlPage = initCostControlPage;
  window.loadCostControl = loadCostControl;
})();
