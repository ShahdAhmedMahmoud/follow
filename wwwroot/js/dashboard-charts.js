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
  if (n === 0) return "";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) {
    const bn = (abs / 1e9).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return `${sign}${bn} Bn`;
  }
  if (abs >= 1e6) {
    const m = (abs / 1e6).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return `${sign}${m} M`;
  }
  if (abs >= 1e3) {
    const k = (abs / 1e3).toFixed(1).replace(/\.0$/, "");
    return `${sign}${k} K`;
  }
  return `${sign}${Math.round(abs)}`;
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
        if (rawVal === 0) return; // Do not draw label for 0/empty bars
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
  chart.options.plugins.mcValueLabels.fontSize = slotW >= 46 ? 13 : slotW >= 40 ? 12 : 11;
  chart.options.scales.x.ticks.font = { size: slotW >= 40 ? 12 : 11, weight: "600", family: FONT };
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
        mcValueLabels: { formatter: fmtChartValue, fontSize: 11, offset: 5, minBarWidth: 0 },
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
            font: { size: 11, weight: "700", family: FONT },
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

function renderCategoryExecutionChart(canvasId, bodyId, rows, fmtNum) {
  const canvas = document.getElementById(canvasId);
  const body = document.getElementById(bodyId);
  if (!canvas || !body || typeof window.Chart === "undefined") return;
  const key = canvasId;
  destroyChart(key, canvas);
  const sorted = rows.filter((r) => Number.isFinite(Number(r.value)) && Number(r.value) !== 0).sort((a, b) => b.value - a.value);
  setEmpty(body, !sorted.length);
  const inner = canvas.parentElement;
  const slot = 54;
  const count = Math.max(sorted.length, 1);
  const viewportWidth = (inner && inner.parentElement && inner.parentElement.clientWidth) || body.clientWidth;
  if (inner) inner.style.width = `${Math.max(viewportWidth, count * slot)}px`;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const chart = new window.Chart(canvas.getContext("2d"), {
    type: "bar",
    plugins: [valueLabelsPlugin],
    data: {
      labels: sorted.length ? sorted.map((r) => r.label) : [""],
      datasets: [{ label: "إجمالي الموقف التنفيذي", data: sorted.length ? sorted.map((r) => r.value) : [0], backgroundColor: COLORS.position, borderWidth: 0, borderRadius: 0, categoryPercentage: 0.8, barPercentage: 0.9, maxBarThickness: 26, clip: false }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 80,
      animation: { duration: 350 },
      layout: { padding: { top: 24, right: 8, bottom: 36, left: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: { rtl: true, callbacks: { title: (items) => sorted[items?.[0]?.dataIndex]?.label || "", label: (ctx) => `الموقف التنفيذي: ${fmtNum(ctx.parsed.y || 0)}` } },
        mcValueLabels: { formatter: fmtChartValue, fontSize: 11, offset: 5, minBarWidth: 0 },
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
            font: { family: FONT, size: 11, weight: "700" },
            callback(value) {
              const label = String(this.getLabelForValue(value));
              return label.length > 24 ? `${label.slice(0, 23)}…` : label;
            },
          },
        },
        y: { display: false, beginAtZero: true, grace: "12%", grid: { display: false } },
      },
    },
  });
  instances[key] = chart;
}

function renderHorizontalExecutionChart(canvasId, bodyId, rows, fmtNum, measureLabel) {
  const canvas = document.getElementById(canvasId);
  const body = document.getElementById(bodyId);
  if (!canvas || !body || typeof window.Chart === "undefined") return;
  destroyChart(canvasId, canvas);
  const inner = canvas.parentElement;
  if (inner) {
    inner.style.width = "100%";
    inner.style.height = `${Math.max(body.clientHeight, rows.length * 38 + 20)}px`;
  }
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const sorted = rows.filter((row) => Number.isFinite(Number(row.value)) && Number(row.value) !== 0).sort((a, b) => b.value - a.value);
  setEmpty(body, !sorted.length);
  const chart = new window.Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: sorted.length ? sorted.map((row) => row.label) : [""],
      datasets: [{
        data: sorted.length ? sorted.map((row) => Number(row.value) || 0) : [0],
        backgroundColor: COLORS.position,
        borderWidth: 0,
        borderRadius: 0,
        barThickness: 24,
        maxBarThickness: 28,
        categoryPercentage: 0.82,
        barPercentage: 0.9,
        clip: false,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 80,
      animation: { duration: 350 },
      layout: { padding: { top: 8, right: 72, bottom: 8, left: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: { rtl: true, callbacks: { label: (ctx) => `${measureLabel}: ${fmtNum(ctx.parsed.x || 0)}` } },
      },
      scales: {
        x: { display: false, beginAtZero: true, grace: "5%", grid: { display: false }, border: { display: false } },
        y: {
          position: "left",
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: "#111827",
            padding: 7,
            font: { family: FONT, size: body.clientWidth < 320 ? 11 : 12, weight: "700" },
            callback(value) {
              const label = String(this.getLabelForValue(value));
              return label.length > 25 ? `${label.slice(0, 24)}…` : label;
            },
          },
        },
      },
    },
    plugins: [{
      id: `${canvasId}ValueLabels`,
      afterDatasetsDraw(instance) {
        const { ctx } = instance;
        ctx.save();
        ctx.font = `700 12px ${FONT}`;
        ctx.fillStyle = "#111827";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        instance.getDatasetMeta(0).data.forEach((bar, index) => {
          const val = Number(sorted[index]?.value) || 0;
          if (!val) return;
          const label = fmtChartValue(val).replace(" Bn", "bn");
          const width = ctx.measureText(label).width;
          const candidate = val < 0 ? bar.x - width - 7 : bar.x + 7;
          const x = Math.max(2, Math.min(candidate, instance.width - width - 2));
          ctx.fillText(label, x, bar.y);
        });
        ctx.restore();
      },
    }],
  });
  instances[canvasId] = chart;
}

function buildExecutionBreakdowns(contracts, maps) {
  const { projectMap, ownerMap, sectorManagers, latestExecutionByContract, executionTotal } = maps;
  const grouped = { owners: new Map(), projects: new Map(), managers: new Map() };
  contracts.forEach((contract) => {
    const value = executionTotal(latestExecutionByContract.get(contract.id));
    const revised = maps.getModifiedTotal(contract);
    const project = projectMap.get(contract.projectId) || {};
    const owner = ownerMap.get(project.ownerId) || {};
    const manager = (sectorManagers || []).find((m) => String(m.id) === String(project.sectorManagerId)) || {};
    const add = (map, key, label, amount, revised = 0) => {
      const groupKey = key || "__unassigned";
      const groupLabel = label || "غير محدد";
      const item = map.get(groupKey) || { label: groupLabel, value: 0, revised: 0, remaining: 0, extracts: 0, due: 0 };
      item.value += Number(amount) || 0;
      item.revised += Number(revised) || 0;
      item.remaining += (Number(amount) || 0) - (Number(revised) || 0);
      map.set(groupKey, item);
    };
    add(grouped.owners, owner.id, owner.name, value, revised);
    add(grouped.projects, project.id, project.name, value, revised);
    add(grouped.managers, manager.id, manager.displayName, value, revised);
  });
  const projectsById = grouped.projects;
  (maps.invoices || []).forEach((invoice) => {
    const contract = maps.contractMap.get(invoice.contractId);
    if (!contract) return;
    const project = projectMap.get(contract.projectId) || {};
    const row = projectsById.get(project.id || "__unassigned");
    if (!row) return;
    const net = Number(maps.getInvoiceNet(invoice)) || 0;
    const paid = Math.max(0, Number.parseFloat(invoice.paidAmount) || 0);
    row.extracts += Number(maps.getInvoiceGross(invoice)) || 0;
    row.due += Math.max(0, net - paid);
  });
  return {
    owners: [...grouped.owners.values()],
    projects: [...grouped.projects.values()],
    managers: [...grouped.managers.values()],
  };
}

function renderProjectExecutionTable(rows, fmtNum) {
  const body = document.getElementById("mcProjectExecutionTableBody");
  const foot = document.getElementById("mcProjectExecutionTableFoot");
  if (!body || !foot) return;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  body.innerHTML = sorted.map((row) => `<tr><td>${escapeChartHtml(row.label)}</td><td>${fmtNum(row.value)}</td><td>${fmtNum(row.revised)}</td><td>${fmtNum(row.remaining)}</td><td>${fmtNum(row.extracts)}</td><td>${fmtNum(row.due)}</td></tr>`).join("");
  const total = sorted.reduce((acc, row) => ({ value: acc.value + row.value, revised: acc.revised + row.revised, remaining: acc.remaining + row.remaining, extracts: acc.extracts + row.extracts, due: acc.due + row.due }), { value: 0, revised: 0, remaining: 0, extracts: 0, due: 0 });
  foot.innerHTML = sorted.length ? `<tr><th>الإجمالي</th><th>${fmtNum(total.value)}</th><th>${fmtNum(total.revised)}</th><th>${fmtNum(total.remaining)}</th><th>${fmtNum(total.extracts)}</th><th>${fmtNum(total.due)}</th></tr>` : "";
}

function escapeChartHtml(value) {
  return String(value ?? "غير محدد").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
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
  projectMap = new Map(),
  ownerMap = new Map(),
  sectorManagers = [],
  latestExecutionByContract = new Map(),
  executionTotal = () => 0,
  invoices = [],
  contractMap = new Map(),
  getInvoiceGross = () => 0,
  getInvoiceNet = () => 0,
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
  try {
    const breakdowns = buildExecutionBreakdowns(list, { projectMap, ownerMap, sectorManagers, latestExecutionByContract, executionTotal, getModifiedTotal, invoices, contractMap, getInvoiceGross, getInvoiceNet });
    renderHorizontalExecutionChart("mcOwnerExecChart", "mcOwnerExecBody", breakdowns.owners, fmtNum, "الموقف التنفيذي");
    renderCategoryExecutionChart("mcProjectExecChart", "mcProjectExecBody", breakdowns.projects, fmtNum);
    renderHorizontalExecutionChart("mcManagerExecChart", "mcManagerExecBody", breakdowns.managers, fmtNum, "الموقف التنفيذي");
    renderHorizontalExecutionChart("mcOwnerRemainingChart", "mcOwnerRemainingBody", breakdowns.owners.map((r) => ({ label: r.label, value: r.remaining })), fmtNum, "المتبقي للتنفيذ");
    renderHorizontalExecutionChart("mcProjectRemainingChart", "mcProjectRemainingBody", breakdowns.projects.map((r) => ({ label: r.label, value: r.remaining })), fmtNum, "المتبقي للتنفيذ");
    renderHorizontalExecutionChart("mcManagerRemainingChart", "mcManagerRemainingBody", breakdowns.managers.map((r) => ({ label: r.label, value: r.remaining })), fmtNum, "المتبقي للتنفيذ");
    renderProjectExecutionTable(breakdowns.projects, fmtNum);
  } catch (err) {
    console.error("Execution comparison charts failed:", err);
  }
}
