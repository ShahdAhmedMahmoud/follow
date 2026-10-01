/**
 * Dashboard charts — Chart.js (global `Chart` loaded from CDN in _Layout)
 *  1) Contract value vs modified contract value (grouped bars per signing year, touching with 0 gap)
 *  2) Cumulative executive position (monthly bars grouped by year, slim thickness matching Chart 1)
 */

const COLORS = { contract: "#1e90ff", modified: "#e8703a", position: "#1e90ff" };
const FONT = 'Tahoma, "Segoe UI", sans-serif';
const NO_DATE = "بدون تاريخ";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const instances = {};
let execView = null;
let resizeBound = false;

/* ---------- smart number formatting helper (never returns 0bn) ---------- */
export const fmtChartValue = (v) => {
  const n = Number(v) || 0;
  if (n <= 0) return "";
  if (n >= 1e9) {
    const bn = (n / 1e9).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return `${bn} Bn`;
  }
  if (n >= 1e6) {
    const m = (n / 1e6).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return `${m} M`;
  }
  if (n >= 1e3) {
    const k = (n / 1e3).toFixed(1).replace(/\.0$/, "");
    return `${k} K`;
  }
  return String(Math.round(n));
};

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const str = String(value).trim();
  // 1. YYYY-MM-DD or ISO (e.g. 2026-09-24 or 2026-09-24T00:00:00)
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) return new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);
  // 2. DD/MM/YYYY or DD-MM-YYYY (e.g. 24/09/2026 or 09/24/2026)
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const p1 = +dmyMatch[1];
    const p2 = +dmyMatch[2];
    const yr = +dmyMatch[3];
    if (p1 > 12) return new Date(yr, p2 - 1, p1);
    if (p2 > 12) return new Date(yr, p1 - 1, p2);
    return new Date(yr, p2 - 1, p1);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function destroyChart(key, canvas) {
  if (instances[key]) {
    instances[key].destroy();
    delete instances[key];
  }
  const existing = window.Chart && window.Chart.getChart ? window.Chart.getChart(canvas) : null;
  if (existing) existing.destroy();
}

function setEmpty(el, isEmpty) {
  if (!el) return;
  if (isEmpty) el.setAttribute("data-empty", "true");
  else el.removeAttribute("data-empty");
}

/* ---------- shared plugin: value labels above bars ---------- */
const valueLabelsPlugin = {
  id: "mcValueLabels",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea } = chart;
    if (!chartArea || !opts) return;
    const format = opts.formatter || fmtChartValue;
    ctx.save();
    ctx.font = `700 ${opts.fontSize || 10}px ${FONT}`;
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) return;
      meta.data.forEach((bar, i) => {
        if (!bar) return;
        const rawVal = Number(dataset.data[i]) || 0;
        if (rawVal <= 0) return; // Do not draw label for 0/empty bars
        const labelText = format(rawVal);
        if (!labelText) return;
        if (Math.abs(bar.width || 0) < (opts.minBarWidth || 0)) return;
        const y = bar.y - (opts.offset || 4);
        if (y < chartArea.top - 6) return;
        ctx.fillText(labelText, bar.x, y);
      });
    });
    ctx.restore();
  },
};

/* ---------- plugin: year row under the month labels ---------- */
const yearGroupsPlugin = {
  id: "mcYearGroups",
  afterDraw(chart, _args, opts) {
    const groups = (opts && opts.groups) || [];
    const xScale = chart.scales && chart.scales.x;
    const area = chart.chartArea;
    if (!groups.length || !xScale || !area) return;
    const n = chart.data.labels.length;
    const slot = (area.right - area.left) / n;
    const top = xScale.bottom + 4;
    const { ctx } = chart;
    ctx.save();
    ctx.font = `700 ${opts.fontSize || 12}px ${FONT}`;
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    groups.forEach((g, gi) => {
      const left = area.left + g.start * slot;
      const right = area.left + (g.end + 1) * slot;
      if (gi > 0) {
        ctx.beginPath();
        ctx.moveTo(left, xScale.bottom);
        ctx.lineTo(left, top + 24);
        ctx.stroke();
      }
      ctx.fillText(g.label, (left + right) / 2, top + 4);
    });
    ctx.restore();
  },
};

/* =====================================================================
 * Chart 1 — Contract value vs Modified contract value (per signing year)
 * Bars are strictly touching with zero gap between "العقد" and "المعدل"
 * ===================================================================== */
function contractLayout(width) {
  const w = Number(width) || 0;
  if (w < 400) return { tick: 9, value: 8, legend: 10, top: 22, minBar: 10, barW: 18 };
  if (w < 640) return { tick: 10, value: 9, legend: 11, top: 24, minBar: 12, barW: 22 };
  if (w < 992) return { tick: 11, value: 10, legend: 12, top: 28, minBar: 14, barW: 26 };
  return { tick: 12, value: 10, legend: 12, top: 32, minBar: 14, barW: 26 };
}

function calcContractBarSizing(width, numCategories) {
  const layout = contractLayout(width);
  const w = Number(width) || 800;
  const cats = Math.max(numCategories || 1, 1);
  const slotW = w / cats;
  const targetCatWidth = layout.barW * 2; // Two touching bars
  const categoryPercentage = Math.min(0.85, Math.max(0.08, targetCatWidth / slotW));
  return {
    categoryPercentage,
    barPercentage: 1.0, // 1.0 guarantees the two bars touch with zero gap
  };
}

function applyContractLayout(chart, width) {
  const l = contractLayout(width);
  chart.options.layout.padding = { top: l.top, right: 6, bottom: 2, left: 6 };
  chart.options.plugins.legend.labels.font = { size: l.legend, weight: "600", family: FONT };
  chart.options.scales.x.ticks.font = { size: l.tick, weight: "700", family: FONT };
  chart.options.plugins.mcValueLabels.fontSize = l.value;
  chart.options.plugins.mcValueLabels.minBarWidth = l.minBar;

  const numCats = chart.data && chart.data.labels ? chart.data.labels.length : 1;
  const sizing = calcContractBarSizing(width, numCats);
  chart.data.datasets.forEach((ds) => {
    ds.categoryPercentage = sizing.categoryPercentage;
    ds.barPercentage = sizing.barPercentage;
  });
}

function renderContractValueChart(contracts, helpers) {
  const canvas = document.getElementById("mcChartContractValue");
  const body = document.getElementById("mcChartContractValueBody");
  if (!canvas || typeof window.Chart === "undefined") return;
  destroyChart("contractValue", canvas);

  const { getModifiedTotal, fmtNum } = helpers;
  const byYear = new Map();
  contracts.forEach((c) => {
    const d = parseDate(c.signDate ?? c.SignDate);
    const year = d ? String(d.getFullYear()) : NO_DATE;
    if (!byYear.has(year)) byYear.set(year, { amount: 0, modified: 0 });
    const row = byYear.get(year);
    row.amount += parseFloat(c.amount) || 0;
    row.modified += getModifiedTotal(c);
  });

  const years = Array.from(byYear.keys()).sort((a, b) => {
    if (a === NO_DATE) return 1;
    if (b === NO_DATE) return -1;
    return Number(a) - Number(b);
  });
  const amounts = years.map((y) => byYear.get(y).amount);
  const modified = years.map((y) => byYear.get(y).modified);
  const hasData = years.length > 0 && amounts.concat(modified).some((v) => v > 0);
  setEmpty(body, !hasData);

  const width = (body && body.clientWidth) || 800;
  const layout = contractLayout(width);
  const sizing = calcContractBarSizing(width, years.length);

  const dsCommon = {
    borderWidth: 0,
    borderRadius: 0,
    categoryPercentage: sizing.categoryPercentage,
    barPercentage: sizing.barPercentage,
    clip: false,
  };

  const chart = new window.Chart(canvas.getContext("2d"), {
    type: "bar",
    plugins: [valueLabelsPlugin],
    data: {
      labels: years.length ? years : [""],
      datasets: [
        { ...dsCommon, label: "قيمة العقد", data: years.length ? amounts : [0], backgroundColor: COLORS.contract },
        { ...dsCommon, label: "قيمة العقد المعدل", data: years.length ? modified : [0], backgroundColor: COLORS.modified },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 80,
      animation: { duration: 400 },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: layout.top, right: 6, bottom: 2, left: 6 } },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          rtl: true,
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 8,
            boxHeight: 8,
            padding: 18,
            color: "#334155",
            font: { size: layout.legend, weight: "600", family: FONT },
          },
        },
        tooltip: {
          rtl: true,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y || 0)}`,
          },
        },
        mcValueLabels: {
          formatter: fmtChartValue,
          fontSize: layout.value,
          offset: 4,
          minBarWidth: layout.minBar,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            autoSkip: true,
            maxRotation: 0,
            minRotation: 0,
            color: "#111827",
            font: { size: layout.tick, weight: "700", family: FONT },
          },
        },
        y: { display: false, beginAtZero: true, grace: "15%", grid: { display: false } },
      },
      onResize(instance, size) {
        applyContractLayout(instance, size && size.width ? size.width : instance.width);
      },
    },
  });

  instances.contractValue = chart;
}

/* =====================================================================
 * Chart 2 — Cumulative executive position (monthly, grouped by year)
 * Bars are kept slim (maxBarThickness: 26) matching Chart 1's thickness
 * ===================================================================== */
const POSITION_KEYS = ["workVolume", "variationOrders", "materials", "claims", "vat"];

function buildExecSeries(contracts, positions) {
  const ids = new Set(contracts.map((c) => c.id));
  const perContract = new Map();
  let minT = Infinity;
  let maxT = -Infinity;

  (positions || []).forEach((p) => {
    if (!ids.has(p.contractId)) return;
    const d = parseDate(p.date);
    if (!d) return;
    const t = d.getTime();
    const total = POSITION_KEYS.reduce((s, k) => s + (parseFloat(p[k]) || 0), 0);
    if (!perContract.has(p.contractId)) perContract.set(p.contractId, []);
    perContract.get(p.contractId).push({ t, ver: parseFloat(p.versionNumber) || 0, total });
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  });

  if (!perContract.size) return { labels: [], years: [], values: [], groups: [] };

  const lists = Array.from(perContract.values());
  lists.forEach((list) => list.sort((a, b) => a.t - b.t || a.ver - b.ver));

  const start = new Date(minT);
  const end = new Date(maxT);
  let y = start.getFullYear();
  let m = start.getMonth();
  const endY = end.getFullYear();
  const endM = end.getMonth();

  const labels = [];
  const years = [];
  const values = [];

  while (y < endY || (y === endY && m <= endM)) {
    const cutoff = new Date(y, m + 1, 1).getTime(); // exclusive end of month
    let sum = 0;
    lists.forEach((list) => {
      let last = null;
      for (const e of list) {
        if (e.t < cutoff) last = e;
        else break;
      }
      if (last) sum += last.total; // carry the latest cumulative value forward
    });
    labels.push(MONTHS[m]);
    years.push(y);
    values.push(sum);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }

  const groups = [];
  years.forEach((yr, i) => {
    const g = groups[groups.length - 1];
    if (g && g.label === String(yr)) g.end = i;
    else groups.push({ label: String(yr), start: i, end: i });
  });

  return { labels, years, values, groups };
}

function execSlot() {
  return window.innerWidth < 576 ? 34 : 36;
}

function sizeExecInner(view) {
  view.inner.style.width = `${view.n * execSlot()}px`;
}

function applyExecLayout(chart, width, n) {
  const slotW = n ? width / n : 36;
  chart.options.plugins.mcValueLabels.fontSize = slotW >= 46 ? 11 : slotW >= 40 ? 10 : 9;
  chart.options.scales.x.ticks.font = { size: slotW >= 40 ? 11 : 10, weight: "600", family: FONT };
}

function bindResizeOnce() {
  if (resizeBound) return;
  resizeBound = true;
  let timer = null;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!execView) return;
      sizeExecInner(execView);
      execView.chart.resize();
    }, 120);
  });
}

function renderExecPositionChart(contracts, positions, helpers) {
  const canvas = document.getElementById("mcChartExecPosition");
  const scroll = document.getElementById("mcChartExecPositionScroll");
  const inner = document.getElementById("mcChartExecPositionInner");
  const title = document.getElementById("mcExecPositionTitle");
  if (!canvas || !scroll || !inner || typeof window.Chart === "undefined") return;
  destroyChart("execPosition", canvas);
  execView = null;

  const { fmtNum, scopeLabel } = helpers;
  if (title) {
    title.textContent = scopeLabel
      ? `الموقف التنفيذي التراكمي — ${scopeLabel}`
      : "الموقف التنفيذي التراكمي";
  }

  const series = buildExecSeries(contracts, positions);
  const n = series.labels.length;
  const hasData = n > 0 && series.values.some((v) => v > 0);
  setEmpty(scroll, !hasData);

  const view = { chart: null, n: Math.max(n, 1), scroll, inner };
  sizeExecInner(view);
  const initialWidth = view.n * execSlot();

  const chart = new window.Chart(canvas.getContext("2d"), {
    type: "bar",
    plugins: [valueLabelsPlugin, yearGroupsPlugin],
    data: {
      labels: n ? series.labels : [""],
      datasets: [
        {
          label: "الموقف التنفيذي التراكمي",
          data: n ? series.values : [0],
          backgroundColor: COLORS.position,
          borderWidth: 0,
          borderRadius: 0,
          categoryPercentage: 0.8,
          barPercentage: 0.9,
          maxBarThickness: 26, // Slim bars matching Chart 1's thickness
          clip: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 80,
      animation: { duration: 400 },
      layout: { padding: { top: 24, right: 8, bottom: 36, left: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          callbacks: {
            title: (items) => {
              const i = items && items[0] ? items[0].dataIndex : 0;
              return n ? `${series.labels[i]} ${series.years[i]}` : "";
            },
            label: (ctx) => `الموقف التنفيذي: ${fmtNum(ctx.parsed.y || 0)}`,
          },
        },
        mcValueLabels: { formatter: fmtChartValue, fontSize: 9, offset: 4, minBarWidth: 0 },
        mcYearGroups: { groups: series.groups, fontSize: 12 },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            autoSkip: false,
            maxRotation: 90,
            minRotation: 90,
            padding: 4,
            color: "#111827",
            font: { size: 10, weight: "600", family: FONT },
          },
        },
        y: { display: false, beginAtZero: true, grace: "12%", grid: { display: false } },
      },
      onResize(instance, size) {
        applyExecLayout(instance, size && size.width ? size.width : instance.width, view.n);
      },
    },
  });

  applyExecLayout(chart, initialWidth, view.n);
  chart.update("none");

  view.chart = chart;
  execView = view;
  instances.execPosition = chart;
  bindResizeOnce();

  requestAnimationFrame(() => {
    scroll.scrollLeft = scroll.scrollWidth;
  });
}

/* =====================================================================
 * Public entry point (called from erp.js → renderCharts)
 * ===================================================================== */
export function renderDashboardCharts({
  contracts,
  execPositions,
  getModifiedTotal,
  fmtNum,
  scopeLabel,
}) {
  const list = Array.isArray(contracts) ? contracts : [];
  try {
    renderContractValueChart(list, { getModifiedTotal, fmtNum });
  } catch (err) {
    console.error("Contract value chart failed:", err);
  }
  try {
    renderExecPositionChart(list, execPositions || [], { fmtNum, scopeLabel });
  } catch (err) {
    console.error("Executive position chart failed:", err);
  }
}