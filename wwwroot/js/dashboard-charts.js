// /**
//  * Dashboard charts — Chart.js (global `Chart` loaded from CDN in _Layout)
//  *  1) Contract value vs modified contract value (grouped bars per signing year, touching with 0 gap)
//  *  2) Cumulative executive position (monthly bars grouped by year, slim thickness matching Chart 1)
//  */

// const COLORS = { contract: "#1e90ff", modified: "#e8703a", position: "#1e90ff" };
// const FONT = 'Tahoma, "Segoe UI", sans-serif';
// const NO_DATE = "بدون تاريخ";
// const MONTHS = [
//   "January", "February", "March", "April", "May", "June",
//   "July", "August", "September", "October", "November", "December",
// ];

// const instances = {};
// let execView = null;
// let resizeBound = false;
// let latestDashboardChartArgs = null;
// let invoiceMonthlyResizeObserver = null;
// let resizeCurrentInvoiceMonthlyChart = null;
// let invoiceDisbursementChartType = "bar";
// let invoiceChartToggleBound = false;
// let contractValueResizeObserver = null;

// /* ---------- smart number formatting helper (never returns 0bn) ---------- */
// export const fmtChartValue = (v) => {
//   const n = Number(v) || 0;
//   if (n === 0) return "";
//   const abs = Math.abs(n);
//   const sign = n < 0 ? "−" : "";
//   if (abs >= 1e9) {
//     const bn = (abs / 1e9).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
//     return `${sign}${bn} Bn`;
//   }
//   if (abs >= 1e6) {
//     const m = (abs / 1e6).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
//     return `${sign}${m} M`;
//   }
//   if (abs >= 1e3) {
//     const k = (abs / 1e3).toFixed(1).replace(/\.0$/, "");
//     return `${sign}${k} K`;
//   }
//   return `${sign}${Math.round(abs)}`;
// };

// /* Totals in dashboard tables are shown in billions, e.g. 1.25 bn */
// export const fmtBn = (v) =>
//   `${((Number(v) || 0) / 1e9).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bn`;

// function fmtDisbursementChartValue(value) {
//   const amount = Number(value) || 0;
//   if (Math.abs(amount) >= 1000000) return `${Math.round(amount / 1000000)}M`;
//   return fmtChartValue(amount);
// }

// function setInvoiceDisbursementChartType(chart, type) {
//   const isLine = type === "line";
//   chart.config.type = isLine ? "line" : "bar";
//   chart.data.datasets.forEach((dataset, index) => {
//     const color = index === 0 ? COLORS.contract : "#ad4f2a";
//     dataset.backgroundColor = color;
//     dataset.borderColor = isLine ? color : "transparent";
//     dataset.borderWidth = isLine ? 3 : 0;
//     dataset.borderRadius = isLine ? 0 : 2;
//     dataset.tension = isLine ? 0.32 : 0;
//     dataset.pointRadius = isLine ? 4 : 0;
//     dataset.pointHoverRadius = isLine ? 6 : 0;
//     dataset.pointBackgroundColor = color;
//     dataset.pointBorderColor = "#fff";
//     dataset.pointBorderWidth = isLine ? 2 : 0;
//     dataset.maxBarThickness = isLine ? undefined : 24;
//     dataset.fill = false;
//   });
//   chart.options.scales.y.display = isLine;
//   chart.options.scales.y.grid.display = isLine;
//   chart.options.scales.y.ticks.display = isLine;
//   chart.options.scales.y.grace = isLine ? "24%" : "14%";
//   chart.update();
// }

// function bindInvoiceChartToggle() {
//   const toggle = document.querySelector(".mc-invoice-chart-toggle");
//   if (!toggle) return;
//   toggle.querySelectorAll("[data-invoice-chart-type]").forEach((button) => {
//     const selected = button.dataset.invoiceChartType === invoiceDisbursementChartType;
//     button.classList.toggle("is-active", selected);
//     button.setAttribute("aria-pressed", String(selected));
//   });
//   if (invoiceChartToggleBound) return;
//   invoiceChartToggleBound = true;
//   toggle.addEventListener("click", (event) => {
//     const button = event.target.closest("[data-invoice-chart-type]");
//     if (!button || !toggle.contains(button)) return;
//     invoiceDisbursementChartType = button.dataset.invoiceChartType === "line" ? "line" : "bar";
//     toggle.querySelectorAll("[data-invoice-chart-type]").forEach((option) => {
//       const selected = option === button;
//       option.classList.toggle("is-active", selected);
//       option.setAttribute("aria-pressed", String(selected));
//     });
//     const chart = instances.invoiceDisbursementMonthly;
//     if (chart) setInvoiceDisbursementChartType(chart, invoiceDisbursementChartType);
//   });
// }

// function parseDate(value) {
//   if (!value) return null;
//   if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
//   const str = String(value).trim();
//   // 1. YYYY-MM-DD or ISO (e.g. 2026-09-24 or 2026-09-24T00:00:00)
//   const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
//   if (isoMatch) return new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);
//   // 2. DD/MM/YYYY or DD-MM-YYYY (e.g. 24/09/2026 or 09/24/2026)
//   const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
//   if (dmyMatch) {
//     const p1 = +dmyMatch[1];
//     const p2 = +dmyMatch[2];
//     const yr = +dmyMatch[3];
//     if (p1 > 12) return new Date(yr, p2 - 1, p1);
//     if (p2 > 12) return new Date(yr, p1 - 1, p2);
//     return new Date(yr, p2 - 1, p1);
//   }
//   const d = new Date(value);
//   return isNaN(d.getTime()) ? null : d;
// }

// function destroyChart(key, canvas) {
//   if (instances[key]) {
//     instances[key].destroy();
//     delete instances[key];
//   }
//   const existing = window.Chart && window.Chart.getChart ? window.Chart.getChart(canvas) : null;
//   if (existing) existing.destroy();
// }

// function setEmpty(el, isEmpty) {
//   if (!el) return;
//   if (isEmpty) el.setAttribute("data-empty", "true");
//   else el.removeAttribute("data-empty");
// }

// /* ---------- shared plugin: value labels above bars ---------- */
// const valueLabelsPlugin = {
//   id: "mcValueLabels",
//   afterDatasetsDraw(chart, _args, opts) {
//     const { ctx, chartArea } = chart;
//     if (!chartArea || !opts) return;
//     const format = opts.formatter || fmtChartValue;
//     ctx.save();
//     ctx.font = `700 ${opts.fontSize || 10}px ${FONT}`;
//     ctx.fillStyle = "#111827";
//     ctx.textAlign = "center";
//     ctx.textBaseline = "bottom";
//     chart.data.datasets.forEach((dataset, di) => {
//       const meta = chart.getDatasetMeta(di);
//       if (!meta || meta.hidden) return;
//       meta.data.forEach((bar, i) => {
//         if (!bar) return;
//         const rawVal = Number(dataset.data[i]) || 0;
//         if (rawVal === 0) return; // Do not draw label for 0/empty bars
//         const labelText = format(rawVal);
//         if (!labelText) return;
//         if (Math.abs(bar.width || 0) < (opts.minBarWidth || 0)) return;
//         const contractValue = chart.canvas?.id === "mcChartContractValue";
//         const invoiceCompare = chart.canvas?.id === "mcInvoiceDisbursementChart";
//         const invoiceLineView = invoiceCompare && chart.config.type === "line";
//         let y = bar.y - (opts.offset || 4) - (contractValue ? di * 20 : invoiceCompare ? di * 18 : 0);
//         if (invoiceLineView && di > 0) {
//           const previousPoint = chart.getDatasetMeta(di - 1)?.data?.[i];
//           if (previousPoint) {
//             const previousLabelY = previousPoint.y - (opts.offset || 4);
//             if (Math.abs(y - previousLabelY) < 22) y = previousLabelY - 22;
//           }
//         }
//         if (y < chartArea.top - 6) return;
//         if (invoiceLineView) {
//           const textWidth = ctx.measureText(labelText).width;
//           const centerX = Math.max(
//             chartArea.left + textWidth / 2 + 5,
//             Math.min(bar.x, chartArea.right - textWidth / 2 - 5),
//           );
//           const badgeWidth = textWidth + 10;
//           const badgeHeight = 19;
//           const color = di === 0 ? COLORS.contract : "#ad4f2a";
//           ctx.fillStyle = "rgba(255,255,255,.96)";
//           ctx.fillRect(centerX - badgeWidth / 2, y - badgeHeight + 3, badgeWidth, badgeHeight);
//           ctx.strokeStyle = color;
//           ctx.lineWidth = 1;
//           ctx.strokeRect(centerX - badgeWidth / 2, y - badgeHeight + 3, badgeWidth, badgeHeight);
//           ctx.fillStyle = color;
//           ctx.fillText(labelText, centerX, y - 1);
//         } else {
//           ctx.fillText(labelText, bar.x, y);
//         }
//       });
//     });
//     ctx.restore();
//   },
// };

// /* ---------- plugin: year row under the month labels ---------- */
// const yearGroupsPlugin = {
//   id: "mcYearGroups",
//   afterDraw(chart, _args, opts) {
//     const groups = (opts && opts.groups) || [];
//     const xScale = chart.scales && chart.scales.x;
//     const area = chart.chartArea;
//     if (!groups.length || !xScale || !area) return;
//     const n = chart.data.labels.length;
//     const slot = (area.right - area.left) / n;
//     const top = xScale.bottom + 4;
//     const { ctx } = chart;
//     ctx.save();
//     ctx.font = `700 ${opts.fontSize || 12}px ${FONT}`;
//     ctx.fillStyle = "#111827";
//     ctx.textAlign = "center";
//     ctx.textBaseline = "top";
//     ctx.strokeStyle = "#cbd5e1";
//     ctx.lineWidth = 1;
//     ctx.setLineDash([2, 3]);
//     groups.forEach((g, gi) => {
//       const left = area.left + g.start * slot;
//       const right = area.left + (g.end + 1) * slot;
//       if (gi > 0) {
//         ctx.beginPath();
//         ctx.moveTo(left, xScale.bottom);
//         ctx.lineTo(left, top + 24);
//         ctx.stroke();
//       }
//       ctx.fillText(g.label, (left + right) / 2, top + 4);
//     });
//     ctx.restore();
//   },
// };

// /* =====================================================================
//  * Chart 1 — Contract value vs Modified contract value (per signing year)
//  * Bars are strictly touching with zero gap between "العقد" and "المعدل"
//  * ===================================================================== */
// function contractLayout(width) {
//   return { tick: 12, value: 12, legend: 12, top: 52, minBar: 0, barW: 34 };
// }

// function calcContractBarSizing(width, numCategories) {
//   const layout = contractLayout(width);
//   const w = Number(width) || 800;
//   const cats = Math.max(numCategories || 1, 1);
//   const slotW = w / cats;
//   const targetCatWidth = layout.barW * 2.4; // Separate grouped bars and leave label breathing room
//   const categoryPercentage = Math.min(0.85, Math.max(0.08, targetCatWidth / slotW));
//   return {
//     categoryPercentage,
//     barPercentage: 1.0, // 1.0 guarantees the two bars touch with zero gap
//   };
// }

// function applyContractLayout(chart, width) {
//   const l = contractLayout(width);
//   chart.options.layout.padding = { top: l.top, right: 6, bottom: 2, left: 6 };
//   chart.options.plugins.legend.labels.font = { size: l.legend, weight: "600", family: FONT };
//   chart.options.scales.x.ticks.font = { size: l.tick, weight: "700", family: FONT };
//   chart.options.plugins.mcValueLabels.fontSize = l.value;
//   chart.options.plugins.mcValueLabels.minBarWidth = l.minBar;

//   const numCats = chart.data && chart.data.labels ? chart.data.labels.length : 1;
//   const sizing = calcContractBarSizing(width, numCats);
//   chart.data.datasets.forEach((ds) => {
//     ds.categoryPercentage = sizing.categoryPercentage;
//     ds.barPercentage = sizing.barPercentage;
//   });
// }

// function renderContractValueChart(contracts, helpers) {
//   const canvas = document.getElementById("mcChartContractValue");
//   const body = document.getElementById("mcChartContractValueBody");
//   const inner = body?.querySelector(".mc-contract-value-inner");
//   if (!canvas || typeof window.Chart === "undefined") return;
//   destroyChart("contractValue", canvas);

//   const { getModifiedTotal, fmtNum } = helpers;
//   const byYear = new Map();
//   contracts.forEach((c) => {
//     const d = parseDate(c.signDate ?? c.SignDate);
//     const year = d ? String(d.getFullYear()) : NO_DATE;
//     if (!byYear.has(year)) byYear.set(year, { amount: 0, modified: 0 });
//     const row = byYear.get(year);
//     row.amount += parseFloat(c.amount) || 0;
//     row.modified += getModifiedTotal(c);
//   });

//   const years = Array.from(byYear.keys()).sort((a, b) => {
//     if (a === NO_DATE) return 1;
//     if (b === NO_DATE) return -1;
//     return Number(a) - Number(b);
//   });
//   const amounts = years.map((y) => byYear.get(y).amount);
//   const modified = years.map((y) => byYear.get(y).modified);
//   const hasData = years.length > 0 && amounts.concat(modified).some((v) => v > 0);
//   setEmpty(body, !hasData);

//   const categoryWidth = 132;
//   const width = Math.max((body && body.clientWidth) || 800, years.length * categoryWidth);
//   if (inner) inner.style.width = `${width}px`;
//   const layout = contractLayout(width);
//   const sizing = calcContractBarSizing(width, years.length);

//   const dsCommon = {
//     borderWidth: 0,
//     borderRadius: 0,
//     categoryPercentage: sizing.categoryPercentage,
//     barPercentage: sizing.barPercentage,
//     clip: false,
//   };

//   const chart = new window.Chart(canvas.getContext("2d"), {
//     type: "bar",
//     plugins: [valueLabelsPlugin],
//     data: {
//       labels: years.length ? years : [""],
//       datasets: [
//         { ...dsCommon, label: "قيمة العقد", data: years.length ? amounts : [0], backgroundColor: COLORS.contract },
//         { ...dsCommon, label: "قيمة العقد المعدل", data: years.length ? modified : [0], backgroundColor: COLORS.modified },
//       ],
//     },
//     options: {
//       responsive: true,
//       maintainAspectRatio: false,
//       resizeDelay: 80,
//       animation: { duration: 400 },
//       interaction: { mode: "index", intersect: false },
//       layout: { padding: { top: layout.top, right: 6, bottom: 2, left: 6 } },
//       plugins: {
//         legend: {
//           display: true,
//           position: "bottom",
//           rtl: true,
//           labels: {
//             usePointStyle: true,
//             pointStyle: "circle",
//             boxWidth: 8,
//             boxHeight: 8,
//             padding: 18,
//             color: "#334155",
//             font: { size: layout.legend, weight: "600", family: FONT },
//           },
//         },
//         tooltip: {
//           rtl: true,
//           callbacks: {
//             label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y || 0)}`,
//           },
//         },
//         mcValueLabels: {
//           formatter: fmtChartValue,
//           fontSize: layout.value,
//           offset: 4,
//           minBarWidth: layout.minBar,
//         },
//       },
//       scales: {
//         x: {
//           grid: { display: false },
//           border: { display: false },
//           ticks: {
//             autoSkip: true,
//             maxRotation: 0,
//             minRotation: 0,
//             color: "#111827",
//             font: { size: layout.tick, weight: "700", family: FONT },
//           },
//         },
//         y: { display: false, beginAtZero: true, grace: "15%", grid: { display: false } },
//       },
//       onResize(instance, size) {
//         applyContractLayout(instance, size && size.width ? size.width : instance.width);
//       },
//     },
//   });

//   instances.contractValue = chart;
//   if (body && inner && typeof ResizeObserver !== "undefined") {
//     contractValueResizeObserver?.disconnect();
//     contractValueResizeObserver = new ResizeObserver(() => {
//       const nextWidth = Math.max(body.clientWidth, years.length * categoryWidth);
//       if (inner.style.width !== `${nextWidth}px`) inner.style.width = `${nextWidth}px`;
//       if (chart.width !== nextWidth) chart.resize(nextWidth, inner.clientHeight);
//     });
//     contractValueResizeObserver.observe(body);
//   }
// }

// /* =====================================================================
//  * Chart 2 — Cumulative executive position (monthly, grouped by year)
//  * Bars are kept slim (maxBarThickness: 26) matching Chart 1's thickness
//  * ===================================================================== */
// const POSITION_KEYS = ["workVolume", "variationOrders", "materials", "claims", "vat"];

// function buildExecSeries(contracts, positions) {
//   const ids = new Set(contracts.map((c) => c.id));
//   const perContract = new Map();
//   let minT = Infinity;
//   let maxT = -Infinity;

//   (positions || []).forEach((p) => {
//     if (!ids.has(p.contractId)) return;
//     const d = parseDate(p.date);
//     if (!d) return;
//     const t = d.getTime();
//     const total = POSITION_KEYS.reduce((s, k) => s + (parseFloat(p[k]) || 0), 0);
//     if (!perContract.has(p.contractId)) perContract.set(p.contractId, []);
//     perContract.get(p.contractId).push({ t, ver: parseFloat(p.versionNumber) || 0, total });
//     if (t < minT) minT = t;
//     if (t > maxT) maxT = t;
//   });

//   if (!perContract.size) return { labels: [], years: [], values: [], groups: [] };

//   const lists = Array.from(perContract.values());
//   lists.forEach((list) => list.sort((a, b) => a.t - b.t || a.ver - b.ver));

//   const start = new Date(minT);
//   const end = new Date(maxT);
//   let y = start.getFullYear();
//   let m = start.getMonth();
//   const endY = end.getFullYear();
//   const endM = end.getMonth();

//   const labels = [];
//   const years = [];
//   const values = [];

//   while (y < endY || (y === endY && m <= endM)) {
//     const cutoff = new Date(y, m + 1, 1).getTime(); // exclusive end of month
//     let sum = 0;
//     lists.forEach((list) => {
//       let last = null;
//       for (const e of list) {
//         if (e.t < cutoff) last = e;
//         else break;
//       }
//       if (last) sum += last.total; // carry the latest cumulative value forward
//     });
//     labels.push(MONTHS[m]);
//     years.push(y);
//     values.push(sum);
//     m += 1;
//     if (m > 11) { m = 0; y += 1; }
//   }

//   const groups = [];
//   years.forEach((yr, i) => {
//     const g = groups[groups.length - 1];
//     if (g && g.label === String(yr)) g.end = i;
//     else groups.push({ label: String(yr), start: i, end: i });
//   });

//   return { labels, years, values, groups };
// }

// function execSlot() {
//   return 62;
// }

// function sizeExecInner(view) {
//   view.inner.style.width = `${Math.max(view.scroll.clientWidth, view.n * execSlot())}px`;
// }

// function applyExecLayout(chart, width, n) {
//   const slotW = n ? width / n : 36;
//   chart.options.plugins.mcValueLabels.fontSize = slotW >= 58 ? 13 : 12;
//   chart.options.scales.x.ticks.font = { size: 12, weight: "700", family: FONT };
// }

// function bindResizeOnce() {
//   if (resizeBound) return;
//   resizeBound = true;
//   let timer = null;
//   window.addEventListener("resize", () => {
//     clearTimeout(timer);
//     timer = setTimeout(() => {
//       if (!execView) return;
//       sizeExecInner(execView);
//       execView.chart.resize();
//     }, 120);
//   });
// }

// function renderExecPositionChart(contracts, positions, helpers) {
//   const canvas = document.getElementById("mcChartExecPosition");
//   const scroll = document.getElementById("mcChartExecPositionScroll");
//   const inner = document.getElementById("mcChartExecPositionInner");
//   const title = document.getElementById("mcExecPositionTitle");
//   if (!canvas || !scroll || !inner || typeof window.Chart === "undefined") return;
//   destroyChart("execPosition", canvas);
//   execView = null;

//   const { fmtNum, scopeLabel } = helpers;
//   if (title) {
//     title.textContent = scopeLabel
//       ? `الموقف التنفيذي التراكمي — ${scopeLabel}`
//       : "الموقف التنفيذي التراكمي";
//   }

//   const series = buildExecSeries(contracts, positions);
//   const n = series.labels.length;
//   const hasData = n > 0 && series.values.some((v) => v > 0);
//   setEmpty(scroll, !hasData);

//   const view = { chart: null, n: Math.max(n, 1), scroll, inner };
//   sizeExecInner(view);
//   const initialWidth = Math.max(scroll.clientWidth, view.n * execSlot());

//   const chart = new window.Chart(canvas.getContext("2d"), {
//     type: "bar",
//     plugins: [valueLabelsPlugin, yearGroupsPlugin],
//     data: {
//       labels: n ? series.labels : [""],
//       datasets: [
//         {
//           label: "الموقف التنفيذي التراكمي",
//           data: n ? series.values : [0],
//           backgroundColor: COLORS.position,
//           borderWidth: 0,
//           borderRadius: 0,
//           categoryPercentage: 0.8,
//           barPercentage: 0.9,
//           maxBarThickness: 26, // Slim bars matching Chart 1's thickness
//           clip: false,
//         },
//       ],
//     },
//     options: {
//       responsive: true,
//       maintainAspectRatio: false,
//       resizeDelay: 80,
//       animation: { duration: 400 },
//       layout: { padding: { top: 24, right: 8, bottom: 36, left: 8 } },
//       plugins: {
//         legend: { display: false },
//         tooltip: {
//           rtl: true,
//           callbacks: {
//             title: (items) => {
//               const i = items && items[0] ? items[0].dataIndex : 0;
//               return n ? `${series.labels[i]} ${series.years[i]}` : "";
//             },
//             label: (ctx) => `الموقف التنفيذي: ${fmtNum(ctx.parsed.y || 0)}`,
//           },
//         },
//         mcValueLabels: { formatter: fmtChartValue, fontSize: 11, offset: 5, minBarWidth: 0 },
//         mcYearGroups: { groups: series.groups, fontSize: 12 },
//       },
//       scales: {
//         x: {
//           grid: { display: false },
//           border: { display: false },
//           ticks: {
//             autoSkip: false,
//             maxRotation: 90,
//             minRotation: 90,
//             padding: 4,
//             color: "#111827",
//             font: { size: 11, weight: "700", family: FONT },
//           },
//         },
//         y: { display: false, beginAtZero: true, grace: "12%", grid: { display: false } },
//       },
//       onResize(instance, size) {
//         applyExecLayout(instance, size && size.width ? size.width : instance.width, view.n);
//       },
//     },
//   });

//   applyExecLayout(chart, initialWidth, view.n);
//   chart.update("none");

//   view.chart = chart;
//   execView = view;
//   instances.execPosition = chart;
//   bindResizeOnce();

//   requestAnimationFrame(() => {
//     scroll.scrollLeft = scroll.scrollWidth;
//   });
// }

// function renderCategoryExecutionChart(canvasId, bodyId, rows, fmtNum) {
//   const canvas = document.getElementById(canvasId);
//   const body = document.getElementById(bodyId);
//   if (!canvas || !body || typeof window.Chart === "undefined") return;
//   const key = canvasId;
//   destroyChart(key, canvas);
//   const sorted = rows.filter((r) => Number.isFinite(Number(r.value)) && Number(r.value) !== 0).sort((a, b) => b.value - a.value);
//   setEmpty(body, !sorted.length);
//   const inner = canvas.parentElement;
//   const slot = 54;
//   const count = Math.max(sorted.length, 1);
//   const viewportWidth = (inner && inner.parentElement && inner.parentElement.clientWidth) || body.clientWidth;
//   if (inner) inner.style.width = `${Math.max(viewportWidth, count * slot)}px`;
//   canvas.style.width = "100%";
//   canvas.style.height = "100%";
//   const chart = new window.Chart(canvas.getContext("2d"), {
//     type: "bar",
//     plugins: [valueLabelsPlugin],
//     data: {
//       labels: sorted.length ? sorted.map((r) => r.label) : [""],
//       datasets: [{ label: "إجمالي الموقف التنفيذي", data: sorted.length ? sorted.map((r) => r.value) : [0], backgroundColor: COLORS.position, borderWidth: 0, borderRadius: 0, categoryPercentage: 0.8, barPercentage: 0.9, maxBarThickness: 26, clip: false }],
//     },
//     options: {
//       responsive: true,
//       maintainAspectRatio: false,
//       resizeDelay: 80,
//       animation: { duration: 350 },
//       layout: { padding: { top: 24, right: 8, bottom: 36, left: 8 } },
//       plugins: {
//         legend: { display: false },
//         tooltip: { rtl: true, callbacks: { title: (items) => sorted[items?.[0]?.dataIndex]?.label || "", label: (ctx) => `الموقف التنفيذي: ${fmtNum(ctx.parsed.y || 0)}` } },
//         mcValueLabels: { formatter: fmtChartValue, fontSize: 11, offset: 5, minBarWidth: 0 },
//       },
//       scales: {
//         x: {
//           grid: { display: false },
//           border: { display: false },
//           ticks: {
//             autoSkip: false,
//             maxRotation: 90,
//             minRotation: 90,
//             padding: 4,
//             color: "#111827",
//             font: { family: FONT, size: 11, weight: "700" },
//             callback(value) {
//               const label = String(this.getLabelForValue(value));
//               return label.length > 24 ? `${label.slice(0, 23)}…` : label;
//             },
//           },
//         },
//         y: { display: false, beginAtZero: true, grace: "12%", grid: { display: false } },
//       },
//     },
//   });
//   instances[key] = chart;
// }

// function renderHorizontalExecutionChart(canvasId, bodyId, rows, fmtNum, measureLabel, color) {
//   const canvas = document.getElementById(canvasId);
//   const body = document.getElementById(bodyId);
//   if (!canvas || !body || typeof window.Chart === "undefined") return;
//   destroyChart(canvasId, canvas);
//   const isManagerContractChart = canvasId === "mcManagerContractChart";
//   const isRemainingChart = canvasId === "mcOwnerRemainingChart" || canvasId === "mcManagerRemainingChart" || canvasId === "mcProjectRemainingChart";
//   const rowHeight = isRemainingChart ? 52 : isManagerContractChart ? 52 : 44;
//   const inner = canvas.parentElement;
//   if (inner) {
//     inner.style.width = "100%";
//     inner.style.height = `${Math.max(body.clientHeight, rows.length * rowHeight + 20)}px`;
//   }
//   canvas.style.width = "100%";
//   canvas.style.height = "100%";
//   const sorted = rows
//     .filter((row) => Number.isFinite(Number(row.value)) && (isRemainingChart || Number(row.value) !== 0))
//     .sort((a, b) => isRemainingChart
//       ? Math.abs(Number(b.value)) - Math.abs(Number(a.value))
//       : b.value - a.value);
//   setEmpty(body, !sorted.length);
//   const chart = new window.Chart(canvas.getContext("2d"), {
//     type: "bar",
//     data: {
//       labels: sorted.length ? sorted.map((row) => row.label) : [""],
//       datasets: [{
//         data: sorted.length
//           ? sorted.map((row) => {
//               const value = Number(row.value) || 0;
//               return isRemainingChart ? Math.abs(value) : value;
//             })
//           : [0],
//         backgroundColor: isRemainingChart ? "#1689f7" : color || COLORS.position,
//         borderWidth: 0,
//         borderRadius: isRemainingChart || isManagerContractChart ? 5 : 0,
//         barThickness: isRemainingChart ? 26 : isManagerContractChart ? 26 : 24,
//         maxBarThickness: isRemainingChart ? 28 : isManagerContractChart ? 30 : 28,
//         categoryPercentage: 0.82,
//         barPercentage: 0.9,
//         clip: false,
//       }],
//     },
//     options: {
//       indexAxis: "y",
//       responsive: true,
//       maintainAspectRatio: false,
//       resizeDelay: 80,
//       animation: { duration: 350 },
//       interaction: isRemainingChart ? { mode: "index", axis: "y", intersect: false } : undefined,
//       layout: { padding: { top: isRemainingChart ? 4 : 8, right: isRemainingChart ? 58 : 72, bottom: isRemainingChart ? 4 : 8, left: 4 } },
//       plugins: {
//         legend: { display: false },
//         tooltip: {
//           rtl: true,
//           callbacks: {
//             title: (items) => items?.[0]?.label || "",
//             label: (ctx) => `${measureLabel}: ${fmtNum(ctx.parsed.x || 0)}`,
//           },
//         },
//       },
//       scales: {
//         x: { display: false, beginAtZero: true, grace: isRemainingChart ? "12%" : "5%", grid: { display: false }, border: { display: false } },
//         y: {
//           position: "left",
//           grid: { display: false },
//           border: { display: false },
//           ticks: {
//             color: "#111827",
//             padding: isManagerContractChart || isRemainingChart ? 9 : 7,
//             autoSkip: !isManagerContractChart && !isRemainingChart,
//             font: { family: FONT, size: isManagerContractChart || isRemainingChart ? 12 : body.clientWidth < 320 ? 11 : 12, weight: "700" },
//             callback(value) {
//               const label = String(this.getLabelForValue(value));
//               if (isManagerContractChart) {
//                 const lines = [];
//                 let line = "";
//                 label.split(/\s+/).forEach((word) => {
//                   if (line && `${line} ${word}`.length > 19) {
//                     lines.push(line);
//                     line = word;
//                   } else {
//                     line = line ? `${line} ${word}` : word;
//                   }
//                 });
//                 if (line) lines.push(line);
//                 return lines;
//               }
//               if (isRemainingChart) {
//                 const maxWidth = Math.max(76, this.width - 18);
//                 const context = this.ctx;
//                 context.save();
//                 context.font = `700 12px ${FONT}`;
//                 let visible = label;
//                 while (visible && context.measureText(`${visible}…`).width > maxWidth) {
//                   visible = visible.slice(0, -1);
//                 }
//                 context.restore();
//                 return visible.length < label.length ? `${visible}…` : label;
//               }
//               return label.length > 25 ? `${label.slice(0, 24)}…` : label;
//             },
//           },
//           afterFit(scale) {
//             if (isRemainingChart) {
//               scale.width = Math.max(92, Math.min(124, body.clientWidth * 0.34));
//             }
//           },
//         },
//       },
//     },
//     plugins: [{
//       id: `${canvasId}ValueLabels`,
//       afterDatasetsDraw(instance) {
//         const { ctx, chartArea } = instance;
//         ctx.save();
//         ctx.font = `700 13px ${FONT}`;
//         ctx.fillStyle = "#111827";
//         ctx.textAlign = "left";
//         ctx.textBaseline = "middle";
//         instance.getDatasetMeta(0).data.forEach((bar, index) => {
//           const val = Number(sorted[index]?.value) || 0;
//           if (!val && !isRemainingChart) return;
//           const label = val ? fmtChartValue(val).replace(" Bn", "bn") : "0";
//           const width = ctx.measureText(label).width;
//           const candidate = isRemainingChart
//             ? bar.x + 7
//             : val < 0 ? bar.x - width - 7 : bar.x + 7;
//           const x = isRemainingChart
//             ? Math.max(chartArea.left + 2, Math.min(candidate, instance.width - width - 4))
//             : Math.max(2, Math.min(candidate, instance.width - width - 4));
//           ctx.fillText(label, x, bar.y);
//         });
//         ctx.restore();
//       },
//     }],
//   });
//   instances[canvasId] = chart;
// }

// function buildContractValueByManager(contracts, projectMap, sectorManagers) {
//   const grouped = new Map();
//   const managersById = new Map(
//     (sectorManagers || []).map((manager) => [
//       String(manager.id ?? manager.Id ?? "").trim(),
//       manager,
//     ]),
//   );
//   (contracts || []).forEach((contract) => {
//     const amount = parseFloat(contract.amount) || 0;
//     const project = projectMap.get(contract.projectId) || {};
//     const managerId = String(project.sectorManagerId ?? project.SectorManagerId ?? "").trim();
//     const manager = managersById.get(managerId) || {};
//     const key = managerId || "__unassigned";
//     const label = manager.displayName || manager.DisplayName || manager.name || manager.Name || managerId || "غير محدد";
//     const item = grouped.get(key) || { label, value: 0 };
//     item.value += amount;
//     grouped.set(key, item);
//   });
//   return [...grouped.values()];
// }

// function buildExecutionBreakdowns(contracts, maps) {
//   const { projectMap, ownerMap, sectorManagers, latestExecutionByContract, executionTotal } = maps;
//   const grouped = { owners: new Map(), projects: new Map(), managers: new Map() };
//   contracts.forEach((contract) => {
//     const value = executionTotal(latestExecutionByContract.get(contract.id));
//     const revised = maps.getModifiedTotal(contract);
//     const project = projectMap.get(contract.projectId) || {};
//     const owner = ownerMap.get(project.ownerId) || {};
//     const manager = (sectorManagers || []).find((m) => String(m.id) === String(project.sectorManagerId)) || {};
//     const add = (map, key, label, amount, revised = 0) => {
//       const groupKey = key || "__unassigned";
//       const groupLabel = label || "غير محدد";
//       const item = map.get(groupKey) || { label: groupLabel, value: 0, revised: 0, remaining: 0, extracts: 0, due: 0 };
//       item.value += Number(amount) || 0;
//       item.revised += Number(revised) || 0;
//       // المتبقي للتنفيذ = قيمة العقد المعدل - الموقف التنفيذي
//       item.remaining += (Number(revised) || 0) - (Number(amount) || 0);
//       map.set(groupKey, item);
//     };
//     add(grouped.owners, owner.id, owner.name, value, revised);
//     add(grouped.projects, project.id, project.name, value, revised);
//     add(grouped.managers, manager.id, manager.displayName, value, revised);
//   });
//   const projectsById = grouped.projects;
//   (maps.invoices || []).forEach((invoice) => {
//     const contract = maps.contractMap.get(invoice.contractId);
//     if (!contract) return;
//     const project = projectMap.get(contract.projectId) || {};
//     const row = projectsById.get(project.id || "__unassigned");
//     if (!row) return;
//     const net = Number(maps.getInvoiceNet(invoice)) || 0;
//     const paid = Math.max(0, Number.parseFloat(invoice.paidAmount) || 0);
//     row.extracts += Number(maps.getInvoiceGross(invoice)) || 0;
//     row.due += Math.max(0, net - paid);
//   });
//   return {
//     owners: [...grouped.owners.values()],
//     projects: [...grouped.projects.values()],
//     managers: [...grouped.managers.values()],
//   };
// }

// function renderProjectExecutionTable(rows, fmtNum) {
//   const body = document.getElementById("mcProjectExecutionTableBody");
//   const foot = document.getElementById("mcProjectExecutionTableFoot");
//   if (!body || !foot) return;
//   const sorted = [...rows].sort((a, b) => b.value - a.value);
//   body.innerHTML = sorted.map((row) => `<tr><td>${escapeChartHtml(row.label)}</td><td>${fmtNum(row.value)}</td><td>${fmtNum(row.revised)}</td><td>${fmtNum(row.remaining)}</td><td>${fmtNum(row.extracts)}</td><td>${fmtNum(row.due)}</td></tr>`).join("");
//   const total = sorted.reduce((acc, row) => ({ value: acc.value + row.value, revised: acc.revised + row.revised, remaining: acc.remaining + row.remaining, extracts: acc.extracts + row.extracts, due: acc.due + row.due }), { value: 0, revised: 0, remaining: 0, extracts: 0, due: 0 });
//   foot.innerHTML = sorted.length ? `<tr><th>الإجمالي</th><th>${fmtBn(total.value)}</th><th>${fmtBn(total.revised)}</th><th>${fmtBn(total.remaining)}</th><th>${fmtBn(total.extracts)}</th><th>${fmtBn(total.due)}</th></tr>` : "";
// }

// function renderContractRegisterTable(contracts, projectMap, fmtNum, formatDate) {
//   const body = document.getElementById("mcContractRegisterBody");
//   const foot = document.getElementById("mcContractRegisterFoot");
//   if (!body || !foot) return;
//   const rows = Array.isArray(contracts) ? contracts : [];
//   const total = rows.reduce((sum, contract) => sum + (Number(contract.amount) || 0), 0);
//   body.innerHTML = rows.map((contract) => {
//     const project = projectMap.get(contract.projectId) || {};
//     const durationDays = Number(contract.contractDuration) || 0;
//     return `<tr><td>${escapeChartHtml(project.name || project.Name || "-")}</td><td>${escapeChartHtml(contract.name || contract.Name || "-")}</td><td>${fmtNum(Number(contract.amount) || 0)}</td><td>${escapeChartHtml(formatDate(contract.signDate || contract.SignDate) || "-")}</td><td>${durationDays ? fmtNum(durationDays / 30, 1) : "-"}</td><td>${escapeChartHtml(formatDate(contract.endDate || contract.EndDate) || "-")}</td></tr>`;
//   }).join("");
//   foot.innerHTML = rows.length
//     ? `<tr><th colspan="2">الإجمالي</th><th>${fmtBn(total)}</th><th></th><th></th><th></th></tr>`
//     : `<tr><th colspan="6">لا توجد بيانات مطابقة للفلاتر الحالية</th></tr>`;
// }

// function escapeChartHtml(value) {
//   return String(value ?? "غير محدد").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
// }

// function buildInvoiceDisbursementSeries(invoices, getInvoiceNet) {
//   const monthly = new Map();
//   let minMonth = Infinity;
//   let maxMonth = -Infinity;
//   const trackMonth = (date) => {
//     if (!date) return null;
//     const month = date.getFullYear() * 12 + date.getMonth();
//     minMonth = Math.min(minMonth, month);
//     maxMonth = Math.max(maxMonth, month);
//     if (!monthly.has(month)) monthly.set(month, { expected: 0, actual: 0 });
//     return monthly.get(month);
//   };

//   (invoices || []).forEach((invoice) => {
//     const net = Math.max(0, Number(getInvoiceNet(invoice)) || 0);
//     const paid = Math.max(0, Number(invoice.paidAmount) || 0);
//     const expectedMonth = trackMonth(parseDate(invoice.dueDate));
//     if (expectedMonth) expectedMonth.expected += net;
//     const actualMonth = trackMonth(parseDate(invoice.paymentDate));
//     if (actualMonth) actualMonth.actual += paid;

//   });

//   const labels = [];
//   const years = [];
//   const expected = [];
//   const actual = [];
//   if (Number.isFinite(minMonth) && Number.isFinite(maxMonth)) {
//     for (let month = minMonth; month <= maxMonth; month += 1) {
//       const year = Math.floor(month / 12);
//       const monthIndex = month % 12;
//       const values = monthly.get(month) || { expected: 0, actual: 0 };
//       labels.push(MONTHS[monthIndex]);
//       years.push(year);
//       expected.push(values.expected);
//       actual.push(values.actual);
//     }
//   }
//   const groups = [];
//   years.forEach((year, index) => {
//     const last = groups[groups.length - 1];
//     if (last && last.label === String(year)) last.end = index;
//     else groups.push({ label: String(year), start: index, end: index });
//   });
//   return { labels, years, expected, actual, groups };
// }

// let invoiceTableSortDir = "asc"; // asc = من الأقدم للأحدث
// let invoiceTableSortBound = false;

// /** ترتيب المستخلصات حسب تاريخ المستخلص (التواريخ الفارغة دائماً في آخر الجدول) */
// function sortInvoicesByDate(invoices, dir) {
//   const factor = dir === "desc" ? -1 : 1;
//   return [...(invoices || [])]
//     .map((invoice, index) => ({ invoice, index, time: parseDate(invoice.date || invoice.Date)?.getTime() ?? null }))
//     .sort((a, b) => {
//       if (a.time === null && b.time === null) return a.index - b.index;
//       if (a.time === null) return 1;
//       if (b.time === null) return -1;
//       return (a.time - b.time) * factor || a.index - b.index;
//     })
//     .map((entry) => entry.invoice);
// }

// function bindInvoiceTableSort() {
//   const select = document.getElementById("mcInvoiceSortOrder");
//   if (!select) return;
//   select.value = invoiceTableSortDir;
//   if (invoiceTableSortBound) return;
//   invoiceTableSortBound = true;
//   select.addEventListener("change", () => {
//     invoiceTableSortDir = select.value === "desc" ? "desc" : "asc";
//     const args = latestDashboardChartArgs;
//     if (!args) return;
//     renderInvoiceDisbursementTable(args.invoices, args.projectMap, args.contractMap, args.sectorManagers, args.getInvoiceNet, args.fmtNum, args.formatDate);
//   });
// }

// function renderInvoiceDisbursementTable(invoices, projectMap, contractMap, sectorManagers, getInvoiceNet, fmtNum, formatDate = () => "-") {
//   const body = document.getElementById("mcDisbursementTableBody");
//   const foot = document.getElementById("mcDisbursementTableFoot");
//   if (!body || !foot) return;
//   const managersById = new Map((sectorManagers || []).map((manager) => [String(manager.id ?? manager.Id ?? "").trim(), manager]));
//   const sortedInvoices = sortInvoicesByDate(invoices, invoiceTableSortDir);
//   let expectedTotal = 0;
//   let actualTotal = 0;
//   body.innerHTML = sortedInvoices.map((invoice) => {
//     const contract = contractMap.get(invoice.contractId) || {};
//     const project = projectMap.get(contract.projectId) || {};
//     const managerId = String(project.sectorManagerId ?? project.SectorManagerId ?? "").trim();
//     const manager = managersById.get(managerId) || {};
//     const expected = Math.max(0, Number(getInvoiceNet(invoice)) || 0);
//     const actual = Math.max(0, Number(invoice.paidAmount) || 0);
//     expectedTotal += expected;
//     actualTotal += actual;
//     const managerName = manager.displayName || manager.DisplayName || manager.name || manager.Name || (managerId ? managerId : "غير محدد");
//     const projectName = project.name || project.Name || "-";
//     const contractName = contract.name || contract.Name || "-";
//     const invoiceDate = formatDate(invoice.date || invoice.Date) || "-";
//     return `<tr><td title="${escapeChartHtml(projectName)}">${escapeChartHtml(projectName)}</td><td title="${escapeChartHtml(contractName)}">${escapeChartHtml(contractName)}</td><td>${escapeChartHtml(invoice.number || invoice.Number || "-")}</td><td>${escapeChartHtml(invoiceDate)}</td><td>${fmtNum(expected)}</td><td>${fmtNum(actual)}</td><td title="${escapeChartHtml(managerName)}">${escapeChartHtml(managerName)}</td></tr>`;
//   }).join("");
//   foot.innerHTML = sortedInvoices.length
//     ? `<tr><th colspan="4">الإجمالي</th><th>${fmtBn(expectedTotal)}</th><th>${fmtBn(actualTotal)}</th><th></th></tr>`
//     : `<tr><th colspan="7">لا توجد مستخلصات مطابقة للفلاتر الحالية</th></tr>`;
// }

// function renderInvoiceDisbursementCharts({ invoices, projectMap, contractMap, sectorManagers, getInvoiceNet, getInvoiceGross, fmtNum, formatDate }) {
//   const pendingCount = (invoices || []).filter((invoice) => {
//     const status = String(invoice.paymentStatus || "Pending").trim().toLowerCase();
//     return status === "pending" || status === "معلق";
//   }).length;
//   const pendingCountElement = document.getElementById("mcPendingInvoiceCount");
//   if (pendingCountElement) pendingCountElement.textContent = fmtNum(pendingCount, 0);

//   bindInvoiceTableSort();
//   renderInvoiceDisbursementTable(invoices, projectMap, contractMap, sectorManagers, getInvoiceNet, fmtNum, formatDate);
//   const series = buildInvoiceDisbursementSeries(invoices, getInvoiceNet);
//   bindInvoiceChartToggle();
//   const monthlyCanvas = document.getElementById("mcInvoiceDisbursementChart");
//   const monthlyBody = document.getElementById("mcInvoiceDisbursementBody");
//   if (monthlyCanvas && monthlyBody && typeof window.Chart !== "undefined") {
//     destroyChart("invoiceDisbursementMonthly", monthlyCanvas);
//     const inner = monthlyCanvas.parentElement;
//     const count = Math.max(series.labels.length, 1);
//     const slotWidth = 68;
//     if (inner) {
//       inner.style.width = `${Math.max(monthlyBody.clientWidth, count * slotWidth)}px`;
//       inner.style.height = "100%";
//     }
//     monthlyCanvas.style.width = "100%";
//     monthlyCanvas.style.height = "100%";
//     setEmpty(monthlyBody, !series.labels.length);
//     const isLineView = invoiceDisbursementChartType === "line";
//     const monthlyChart = new window.Chart(monthlyCanvas.getContext("2d"), {
//       type: invoiceDisbursementChartType,
//       plugins: [valueLabelsPlugin, yearGroupsPlugin],
//       data: {
//         labels: series.labels.length ? series.labels : [""],
//         datasets: [
//           { label: "المتوقع صرفه", data: series.expected.length ? series.expected : [0], backgroundColor: COLORS.contract, borderColor: isLineView ? COLORS.contract : "transparent", borderWidth: isLineView ? 3 : 0, borderRadius: 2, tension: 0.32, pointRadius: isLineView ? 4 : 0, pointHoverRadius: isLineView ? 6 : 0, pointBackgroundColor: COLORS.contract, pointBorderColor: "#fff", pointBorderWidth: isLineView ? 2 : 0, categoryPercentage: 0.82, barPercentage: 1, maxBarThickness: isLineView ? undefined : 24, fill: false, clip: false },
//           { label: "المنصرف الفعلي", data: series.actual.length ? series.actual : [0], backgroundColor: "#ad4f2a", borderColor: isLineView ? "#ad4f2a" : "transparent", borderWidth: isLineView ? 3 : 0, borderRadius: 2, tension: 0.32, pointRadius: isLineView ? 4 : 0, pointHoverRadius: isLineView ? 6 : 0, pointBackgroundColor: "#ad4f2a", pointBorderColor: "#fff", pointBorderWidth: isLineView ? 2 : 0, categoryPercentage: 0.82, barPercentage: 1, maxBarThickness: isLineView ? undefined : 24, fill: false, clip: false },
//         ],
//       },
//       options: {
//         responsive: true,
//         maintainAspectRatio: false,
//         resizeDelay: 80,
//         animation: { duration: 300 },
//         interaction: { mode: "index", intersect: false },
//         layout: { padding: { top: 24, right: 14, bottom: 38, left: 14 } },
//         plugins: {
//           legend: { display: true, position: "top", align: "center", rtl: true, labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 9, boxHeight: 9, padding: 16, font: { family: FONT, size: 13, weight: "700" } } },
//           tooltip: { rtl: true, callbacks: { title: (items) => items?.[0] ? `${series.labels[items[0].dataIndex]} ${series.years[items[0].dataIndex]}` : "", label: (context) => `${context.dataset.label}: ${fmtNum(context.parsed.y || 0)}` } },
//           mcValueLabels: { formatter: fmtDisbursementChartValue, fontSize: 12, offset: 5, minBarWidth: 0 },
//           mcYearGroups: { groups: series.groups, fontSize: 12 },
//         },
//         scales: {
//           x: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, maxRotation: 90, minRotation: 90, padding: 5, color: "#111827", font: { family: FONT, size: 12, weight: "700" } } },
//           y: {
//             display: invoiceDisbursementChartType === "line",
//             beginAtZero: true,
//             grace: invoiceDisbursementChartType === "line" ? "24%" : "14%",
//             grid: { display: invoiceDisbursementChartType === "line", color: "#e5ebf2" },
//             ticks: {
//               display: invoiceDisbursementChartType === "line",
//               color: "#526579",
//               padding: 8,
//               font: { family: FONT, size: 11, weight: "600" },
//               callback: (value) => fmtDisbursementChartValue(value),
//             },
//           },
//         },
//       },
//     });
//     resizeCurrentInvoiceMonthlyChart = () => {
//       const targetWidth = Math.max(monthlyBody.clientWidth, count * 68);
//       inner.style.width = `${targetWidth}px`;
//       inner.style.height = "100%";
//       const targetHeight = inner.clientHeight || monthlyBody.clientHeight;
//       monthlyCanvas.style.width = "100%";
//       monthlyCanvas.style.height = "100%";
//       monthlyChart.resize(targetWidth, targetHeight);
//     };
//     resizeCurrentInvoiceMonthlyChart();
//     invoiceMonthlyResizeObserver?.disconnect();
//     if (typeof ResizeObserver !== "undefined") {
//       invoiceMonthlyResizeObserver = new ResizeObserver(() => resizeCurrentInvoiceMonthlyChart?.());
//       invoiceMonthlyResizeObserver.observe(monthlyBody);
//     }
//     instances.invoiceDisbursementMonthly = monthlyChart;
//     requestAnimationFrame(() => {
//       if (inner && inner.scrollWidth > monthlyBody.clientWidth) monthlyBody.scrollLeft = monthlyBody.scrollWidth;
//     });
//   }

//   const managerCanvas = document.getElementById("mcManagerDisbursementChart");
//   const managerBody = document.getElementById("mcManagerDisbursementBody");
//   if (!managerCanvas || !managerBody || typeof window.Chart === "undefined") return;
//   destroyChart("managerDisbursement", managerCanvas);
//   const managersById = new Map((sectorManagers || []).map((manager) => [String(manager.id ?? manager.Id ?? "").trim(), manager]));
//   const managerTotals = new Map();
//   (invoices || []).forEach((invoice) => {
//     const contract = contractMap.get(invoice.contractId) || {};
//     const project = projectMap.get(contract.projectId) || {};
//     const managerId = String(project.sectorManagerId ?? project.SectorManagerId ?? "").trim();
//     const manager = managersById.get(managerId) || {};
//     const key = managerId || "__unassigned";
//     const row = managerTotals.get(key) || { label: manager.displayName || manager.DisplayName || manager.name || manager.Name || managerId || "غير محدد", expected: 0, actual: 0 };
//     row.expected += Math.max(0, Number(getInvoiceNet(invoice)) || 0);
//     row.actual += Math.max(0, Number(invoice.paidAmount) || 0);
//     managerTotals.set(key, row);
//   });
//   const managerRows = [...managerTotals.values()].filter((row) => row.expected || row.actual).sort((a, b) => b.expected - a.expected);
//   const managerInner = managerCanvas.parentElement;
//   const managerRowHeight = 90;
//   if (managerInner) {
//     managerInner.style.width = "100%";
//     managerInner.style.height = `${Math.max(managerBody.clientHeight, managerRows.length * managerRowHeight + 64)}px`;
//   }
//   managerCanvas.style.width = "100%";
//   managerCanvas.style.height = "100%";
//   setEmpty(managerBody, !managerRows.length);
//   const managerChart = new window.Chart(managerCanvas.getContext("2d"), {
//     type: "bar",
//     data: {
//       labels: managerRows.length ? managerRows.map((row) => row.label) : [""],
//       datasets: [
//         { label: "المتوقع صرفه", data: managerRows.length ? managerRows.map((row) => row.expected) : [0], backgroundColor: COLORS.contract, borderWidth: 0, borderRadius: 0, barThickness: 30, maxBarThickness: 32, categoryPercentage: 0.82, barPercentage: 0.9, clip: false },
//         { label: "المنصرف الفعلي", data: managerRows.length ? managerRows.map((row) => row.actual) : [0], backgroundColor: "#ad4f2a", borderWidth: 0, borderRadius: 0, barThickness: 30, maxBarThickness: 32, categoryPercentage: 0.82, barPercentage: 0.9, clip: false },
//       ],
//     },
//     options: {
//       indexAxis: "y",
//       responsive: true,
//       maintainAspectRatio: false,
//       resizeDelay: 80,
//       animation: { duration: 300 },
//       interaction: { mode: "index", axis: "y", intersect: false },
//       layout: { padding: { top: 12, right: 58, bottom: 12, left: 8 } },
//       plugins: {
//         legend: { display: true, position: "top", rtl: true, labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 9, boxHeight: 9, padding: 12, font: { family: FONT, size: 12, weight: "700" } } },
//         tooltip: { rtl: true, callbacks: { title: (items) => items?.[0]?.label || "", label: (context) => `${context.dataset.label}: ${fmtNum(context.parsed.x || 0)}` } },
//       },
//       scales: {
//         x: { display: false, beginAtZero: true, grace: "24%", grid: { display: false }, border: { display: false } },
//         y: { position: "left", grid: { display: false }, border: { display: false }, ticks: { color: "#111827", padding: 7, autoSkip: false, font: { family: FONT, size: 11, weight: "700" }, callback(value) { const label = String(this.getLabelForValue(value)); return label.length > 18 ? `${label.slice(0, 17)}…` : label; } } },
//       },
//     },
//     plugins: [{
//       id: "managerDisbursementValueLabels",
//       afterDatasetsDraw(chart) {
//         const { ctx } = chart;
//         ctx.save();
//         ctx.font = `700 12px ${FONT}`;
//         ctx.fillStyle = "#111827";
//         ctx.textAlign = "left";
//         ctx.textBaseline = "middle";
//         chart.data.datasets.forEach((dataset, datasetIndex) => {
//           chart.getDatasetMeta(datasetIndex).data.forEach((bar, index) => {
//             const label = fmtDisbursementChartValue(dataset.data[index]);
//             if (!label) return;
//             const textWidth = ctx.measureText(label).width;
//             const x = Math.min(bar.x + 5, chart.width - textWidth - 3);
//             ctx.fillText(label, x, bar.y);
//           });
//         });
//         ctx.restore();
//       },
//     }],
//   });
//   instances.managerDisbursement = managerChart;
// }

// /* =====================================================================
//  * Public entry point (called from erp.js → renderCharts)
//  * ===================================================================== */
// export function renderDashboardCharts({
//   contracts,
//   execPositions,
//   getModifiedTotal,
//   fmtNum,
//   formatDate = () => "-",
//   scopeLabel,
//   projectMap = new Map(),
//   ownerMap = new Map(),
//   sectorManagers = [],
//   latestExecutionByContract = new Map(),
//   executionTotal = () => 0,
//   invoices = [],
//   contractMap = new Map(),
//   getInvoiceGross = () => 0,
//   getInvoiceNet = () => 0,
// }) {
//   const list = Array.isArray(contracts) ? contracts : [];
//   latestDashboardChartArgs = {
//     contracts: list,
//     execPositions,
//     getModifiedTotal,
//     fmtNum,
//     formatDate,
//     scopeLabel,
//     projectMap,
//     ownerMap,
//     sectorManagers,
//     latestExecutionByContract,
//     executionTotal,
//     invoices,
//     contractMap,
//     getInvoiceGross,
//     getInvoiceNet,
//   };
//   renderInvoiceDisbursementCharts({ invoices, projectMap, contractMap, sectorManagers, getInvoiceNet, getInvoiceGross, fmtNum, formatDate });
//   renderContractRegisterTable(list, projectMap, fmtNum, formatDate);
//   try {
//     renderContractValueChart(list, { getModifiedTotal, fmtNum });
//   } catch (err) {
//     console.error("Contract value chart failed:", err);
//   }
//   try {
//     const byManager = buildContractValueByManager(list, projectMap, sectorManagers);
//     renderHorizontalExecutionChart(
//       "mcManagerContractChart",
//       "mcManagerContractBody",
//       byManager,
//       fmtNum,
//       "قيمة التعاقد",
//       COLORS.contract,
//     );
//   } catch (err) {
//     console.error("Contract value by sector manager chart failed:", err);
//   }
//   try {
//     renderExecPositionChart(list, execPositions || [], { fmtNum, scopeLabel });
//   } catch (err) {
//     console.error("Executive position chart failed:", err);
//   }
//   try {
//     const breakdowns = buildExecutionBreakdowns(list, { projectMap, ownerMap, sectorManagers, latestExecutionByContract, executionTotal, getModifiedTotal, invoices, contractMap, getInvoiceGross, getInvoiceNet });
//     renderHorizontalExecutionChart("mcOwnerExecChart", "mcOwnerExecBody", breakdowns.owners, fmtNum, "الموقف التنفيذي");
//     renderCategoryExecutionChart("mcProjectExecChart", "mcProjectExecBody", breakdowns.projects, fmtNum);
//     renderHorizontalExecutionChart("mcManagerExecChart", "mcManagerExecBody", breakdowns.managers, fmtNum, "الموقف التنفيذي");
//     renderHorizontalExecutionChart("mcOwnerRemainingChart", "mcOwnerRemainingBody", breakdowns.owners.map((r) => ({ label: r.label, value: r.remaining })), fmtNum, "المتبقي للتنفيذ");
//     renderHorizontalExecutionChart("mcProjectRemainingChart", "mcProjectRemainingBody", breakdowns.projects.map((r) => ({ label: r.label, value: r.remaining })), fmtNum, "المتبقي للتنفيذ");
//     renderHorizontalExecutionChart("mcManagerRemainingChart", "mcManagerRemainingBody", breakdowns.managers.map((r) => ({ label: r.label, value: r.remaining })), fmtNum, "المتبقي للتنفيذ");
//     renderProjectExecutionTable(breakdowns.projects, fmtNum);
//   } catch (err) {
//     console.error("Execution comparison charts failed:", err);
//   }
// }

// export function resizeDashboardCharts() {
//   requestAnimationFrame(() => {
//     const activePanel = document.querySelector("[data-dashboard-panel]:not([hidden])");
//     if (activePanel && activePanel.getBoundingClientRect().width > 0) {
//       const visibleCharts = [...activePanel.querySelectorAll("canvas")]
//         .map((canvas) => window.Chart?.getChart?.(canvas))
//         .filter(Boolean);
//       if (visibleCharts.some((chart) => !chart.width || !chart.height) && latestDashboardChartArgs) {
//         renderDashboardCharts(latestDashboardChartArgs);
//         return;
//       }
//     }
//     const monthlyChart = instances.invoiceDisbursementMonthly;
//     if (monthlyChart) resizeCurrentInvoiceMonthlyChart?.();
//     Object.values(instances).forEach((chart) => {
//       if (!chart || !chart.canvas?.isConnected || chart === monthlyChart) return;
//       const panel = chart.canvas.closest("[data-dashboard-panel]");
//       if (panel?.hidden) return;
//       const parent = chart.canvas.parentElement;
//       if (!parent?.clientWidth || !parent?.clientHeight) return;
//       chart.canvas.style.width = "100%";
//       chart.canvas.style.height = "100%";
//       chart.resize(parent.clientWidth, parent.clientHeight);
//     });
//     if (execView?.chart && execView.chart.canvas?.isConnected && !execView.chart.canvas.closest("[data-dashboard-panel]")?.hidden) {
//       sizeExecInner(execView);
//       execView.chart.canvas.style.width = "100%";
//       execView.chart.canvas.style.height = "100%";
//       execView.chart.resize(execView.inner.clientWidth, execView.inner.clientHeight);
//     }
//   });
// }


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
let latestDashboardChartArgs = null;
let invoiceMonthlyResizeObserver = null;
let resizeCurrentInvoiceMonthlyChart = null;
let invoiceDisbursementChartType = "bar";
let invoiceChartToggleBound = false;
let contractValueResizeObserver = null;

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

/* Totals in dashboard tables are shown in billions, e.g. 1.25 bn */
export const fmtBn = (v) =>
  `${((Number(v) || 0) / 1e9).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bn`;

function fmtDisbursementChartValue(value) {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1000000) return `${Math.round(amount / 1000000)}M`;
  return fmtChartValue(amount);
}

function setInvoiceDisbursementChartType(chart, type) {
  const isLine = type === "line";
  chart.config.type = isLine ? "line" : "bar";
  chart.data.datasets.forEach((dataset, index) => {
    const color = index === 0 ? COLORS.contract : "#ad4f2a";
    dataset.backgroundColor = color;
    dataset.borderColor = isLine ? color : "transparent";
    dataset.borderWidth = isLine ? 3 : 0;
    dataset.borderRadius = isLine ? 0 : 2;
    dataset.tension = isLine ? 0.32 : 0;
    dataset.pointRadius = isLine ? 4 : 0;
    dataset.pointHoverRadius = isLine ? 6 : 0;
    dataset.pointBackgroundColor = color;
    dataset.pointBorderColor = "#fff";
    dataset.pointBorderWidth = isLine ? 2 : 0;
    dataset.maxBarThickness = isLine ? undefined : 24;
    dataset.fill = false;
  });
  chart.options.scales.y.display = isLine;
  chart.options.scales.y.grid.display = isLine;
  chart.options.scales.y.ticks.display = isLine;
  chart.options.scales.y.grace = isLine ? "24%" : "14%";
  chart.update();
}

function bindInvoiceChartToggle() {
  const toggle = document.querySelector(".mc-invoice-chart-toggle");
  if (!toggle) return;
  toggle.querySelectorAll("[data-invoice-chart-type]").forEach((button) => {
    const selected = button.dataset.invoiceChartType === invoiceDisbursementChartType;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  if (invoiceChartToggleBound) return;
  invoiceChartToggleBound = true;
  toggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-invoice-chart-type]");
    if (!button || !toggle.contains(button)) return;
    invoiceDisbursementChartType = button.dataset.invoiceChartType === "line" ? "line" : "bar";
    toggle.querySelectorAll("[data-invoice-chart-type]").forEach((option) => {
      const selected = option === button;
      option.classList.toggle("is-active", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
    const chart = instances.invoiceDisbursementMonthly;
    if (chart) setInvoiceDisbursementChartType(chart, invoiceDisbursementChartType);
  });
}

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
        const contractValue = chart.canvas?.id === "mcChartContractValue";
        const invoiceCompare = chart.canvas?.id === "mcInvoiceDisbursementChart";
        const invoiceLineView = invoiceCompare && chart.config.type === "line";
        let y = bar.y - (opts.offset || 4) - (contractValue ? di * 20 : invoiceCompare ? di * 18 : 0);
        if (invoiceLineView && di > 0) {
          const previousPoint = chart.getDatasetMeta(di - 1)?.data?.[i];
          if (previousPoint) {
            const previousLabelY = previousPoint.y - (opts.offset || 4);
            if (Math.abs(y - previousLabelY) < 22) y = previousLabelY - 22;
          }
        }
        if (y < chartArea.top - 6) return;
        if (invoiceLineView) {
          const textWidth = ctx.measureText(labelText).width;
          const centerX = Math.max(
            chartArea.left + textWidth / 2 + 5,
            Math.min(bar.x, chartArea.right - textWidth / 2 - 5),
          );
          const badgeWidth = textWidth + 10;
          const badgeHeight = 19;
          const color = di === 0 ? COLORS.contract : "#ad4f2a";
          ctx.fillStyle = "rgba(255,255,255,.96)";
          ctx.fillRect(centerX - badgeWidth / 2, y - badgeHeight + 3, badgeWidth, badgeHeight);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.strokeRect(centerX - badgeWidth / 2, y - badgeHeight + 3, badgeWidth, badgeHeight);
          ctx.fillStyle = color;
          ctx.fillText(labelText, centerX, y - 1);
        } else {
          ctx.fillText(labelText, bar.x, y);
        }
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
  return { tick: 12, value: 12, legend: 12, top: 52, minBar: 0, barW: 34 };
}

function calcContractBarSizing(width, numCategories) {
  const layout = contractLayout(width);
  const w = Number(width) || 800;
  const cats = Math.max(numCategories || 1, 1);
  const slotW = w / cats;
  const targetCatWidth = layout.barW * 2.4; // Separate grouped bars and leave label breathing room
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
  const inner = body?.querySelector(".mc-contract-value-inner");
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

  const categoryWidth = 132;
  const width = Math.max((body && body.clientWidth) || 800, years.length * categoryWidth);
  if (inner) inner.style.width = `${width}px`;
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
  if (body && inner && typeof ResizeObserver !== "undefined") {
    contractValueResizeObserver?.disconnect();
    contractValueResizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(body.clientWidth, years.length * categoryWidth);
      if (inner.style.width !== `${nextWidth}px`) inner.style.width = `${nextWidth}px`;
      if (chart.width !== nextWidth) chart.resize(nextWidth, inner.clientHeight);
    });
    contractValueResizeObserver.observe(body);
  }
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
  return 62;
}

function sizeExecInner(view) {
  view.inner.style.width = `${Math.max(view.scroll.clientWidth, view.n * execSlot())}px`;
}

function applyExecLayout(chart, width, n) {
  const slotW = n ? width / n : 36;
  chart.options.plugins.mcValueLabels.fontSize = slotW >= 58 ? 13 : 12;
  chart.options.scales.x.ticks.font = { size: 12, weight: "700", family: FONT };
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
  const initialWidth = Math.max(scroll.clientWidth, view.n * execSlot());

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

function renderHorizontalExecutionChart(canvasId, bodyId, rows, fmtNum, measureLabel, color) {
  const canvas = document.getElementById(canvasId);
  const body = document.getElementById(bodyId);
  if (!canvas || !body || typeof window.Chart === "undefined") return;
  destroyChart(canvasId, canvas);
  const isManagerContractChart = canvasId === "mcManagerContractChart";
  const isRemainingChart = canvasId === "mcOwnerRemainingChart" || canvasId === "mcManagerRemainingChart" || canvasId === "mcProjectRemainingChart";
  const rowHeight = isRemainingChart ? 52 : isManagerContractChart ? 52 : 44;
  const inner = canvas.parentElement;
  if (inner) {
    inner.style.width = "100%";
    inner.style.height = `${Math.max(body.clientHeight, rows.length * rowHeight + 20)}px`;
  }
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const sorted = rows
    .filter((row) => Number.isFinite(Number(row.value)) && (isRemainingChart || Number(row.value) !== 0))
    .sort((a, b) => isRemainingChart
      ? Math.abs(Number(b.value)) - Math.abs(Number(a.value))
      : b.value - a.value);
  setEmpty(body, !sorted.length);
  const chart = new window.Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: sorted.length ? sorted.map((row) => row.label) : [""],
      datasets: [{
        data: sorted.length
          ? sorted.map((row) => {
              const value = Number(row.value) || 0;
              return isRemainingChart ? Math.abs(value) : value;
            })
          : [0],
        backgroundColor: isRemainingChart ? "#1689f7" : color || COLORS.position,
        borderWidth: 0,
        borderRadius: isRemainingChart || isManagerContractChart ? 5 : 0,
        barThickness: isRemainingChart ? 26 : isManagerContractChart ? 26 : 24,
        maxBarThickness: isRemainingChart ? 28 : isManagerContractChart ? 30 : 28,
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
      interaction: isRemainingChart ? { mode: "index", axis: "y", intersect: false } : undefined,
      layout: { padding: { top: isRemainingChart ? 4 : 8, right: isRemainingChart ? 58 : 72, bottom: isRemainingChart ? 4 : 8, left: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          callbacks: {
            title: (items) => items?.[0]?.label || "",
            label: (ctx) => `${measureLabel}: ${fmtNum(ctx.parsed.x || 0)}`,
          },
        },
      },
      scales: {
        x: { display: false, beginAtZero: true, grace: isRemainingChart ? "12%" : "5%", grid: { display: false }, border: { display: false } },
        y: {
          position: "left",
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: "#111827",
            padding: isManagerContractChart || isRemainingChart ? 9 : 7,
            autoSkip: !isManagerContractChart && !isRemainingChart,
            font: { family: FONT, size: isManagerContractChart || isRemainingChart ? 12 : body.clientWidth < 320 ? 11 : 12, weight: "700" },
            callback(value) {
              const label = String(this.getLabelForValue(value));
              if (isManagerContractChart) {
                const lines = [];
                let line = "";
                label.split(/\s+/).forEach((word) => {
                  if (line && `${line} ${word}`.length > 19) {
                    lines.push(line);
                    line = word;
                  } else {
                    line = line ? `${line} ${word}` : word;
                  }
                });
                if (line) lines.push(line);
                return lines;
              }
              if (isRemainingChart) {
                const maxWidth = Math.max(76, this.width - 18);
                const context = this.ctx;
                context.save();
                context.font = `700 12px ${FONT}`;
                let visible = label;
                while (visible && context.measureText(`${visible}…`).width > maxWidth) {
                  visible = visible.slice(0, -1);
                }
                context.restore();
                return visible.length < label.length ? `${visible}…` : label;
              }
              return label.length > 25 ? `${label.slice(0, 24)}…` : label;
            },
          },
          afterFit(scale) {
            if (isRemainingChart) {
              scale.width = Math.max(92, Math.min(124, body.clientWidth * 0.34));
            }
          },
        },
      },
    },
    plugins: [{
      id: `${canvasId}ValueLabels`,
      afterDatasetsDraw(instance) {
        const { ctx, chartArea } = instance;
        ctx.save();
        ctx.font = `700 13px ${FONT}`;
        ctx.fillStyle = "#111827";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        instance.getDatasetMeta(0).data.forEach((bar, index) => {
          const val = Number(sorted[index]?.value) || 0;
          if (!val && !isRemainingChart) return;
          const label = val ? fmtChartValue(val).replace(" Bn", "bn") : "0";
          const width = ctx.measureText(label).width;
          const candidate = isRemainingChart
            ? bar.x + 7
            : val < 0 ? bar.x - width - 7 : bar.x + 7;
          const x = isRemainingChart
            ? Math.max(chartArea.left + 2, Math.min(candidate, instance.width - width - 4))
            : Math.max(2, Math.min(candidate, instance.width - width - 4));
          ctx.fillText(label, x, bar.y);
        });
        ctx.restore();
      },
    }],
  });
  instances[canvasId] = chart;
}

function buildContractValueByManager(contracts, projectMap, sectorManagers) {
  const grouped = new Map();
  const managersById = new Map(
    (sectorManagers || []).map((manager) => [
      String(manager.id ?? manager.Id ?? "").trim(),
      manager,
    ]),
  );
  (contracts || []).forEach((contract) => {
    const amount = parseFloat(contract.amount) || 0;
    const project = projectMap.get(contract.projectId) || {};
    const managerId = String(project.sectorManagerId ?? project.SectorManagerId ?? "").trim();
    const manager = managersById.get(managerId) || {};
    const key = managerId || "__unassigned";
    const label = manager.displayName || manager.DisplayName || manager.name || manager.Name || managerId || "غير محدد";
    const item = grouped.get(key) || { label, value: 0 };
    item.value += amount;
    grouped.set(key, item);
  });
  return [...grouped.values()];
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
      // المتبقي للتنفيذ = قيمة العقد المعدل - الموقف التنفيذي
      item.remaining += (Number(revised) || 0) - (Number(amount) || 0);
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
  foot.innerHTML = sorted.length ? `<tr><th>الإجمالي</th><th>${fmtBn(total.value)}</th><th>${fmtBn(total.revised)}</th><th>${fmtBn(total.remaining)}</th><th>${fmtBn(total.extracts)}</th><th>${fmtBn(total.due)}</th></tr>` : "";
}

/* Contract duration in whole months (calendar-based when both dates exist, otherwise days / 30.4375). */
function contractDurationMonths(contract) {
  const days = Number(contract?.contractDuration ?? contract?.ContractDuration) || 0;
  if (days <= 0) return 0;
  const start = parseDate(contract.signDate || contract.SignDate);
  const end = parseDate(contract.endDate || contract.EndDate);
  if (start && end && end > start) {
    let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    const anchor = new Date(start.getFullYear(), start.getMonth() + months, start.getDate());
    if (anchor > end) months -= 1;
    const base = new Date(start.getFullYear(), start.getMonth() + months, start.getDate());
    const leftoverDays = Math.round((end - base) / 86400000);
    return Math.max(1, months + (leftoverDays >= 15 ? 1 : 0));
  }
  return Math.max(1, Math.round(days / 30.4375));
}

function renderContractRegisterTable(contracts, projectMap, fmtNum, formatDate) {
  const body = document.getElementById("mcContractRegisterBody");
  const foot = document.getElementById("mcContractRegisterFoot");
  if (!body || !foot) return;
  const rows = Array.isArray(contracts) ? contracts : [];
  const total = rows.reduce((sum, contract) => sum + (Number(contract.amount) || 0), 0);
  body.innerHTML = rows.map((contract) => {
    const project = projectMap.get(contract.projectId) || {};
    const durationMonths = contractDurationMonths(contract);
    return `<tr><td>${escapeChartHtml(project.name || project.Name || "-")}</td><td>${escapeChartHtml(contract.name || contract.Name || "-")}</td><td>${fmtNum(Number(contract.amount) || 0)}</td><td>${escapeChartHtml(formatDate(contract.signDate || contract.SignDate) || "-")}</td><td>${durationMonths ? fmtNum(durationMonths, 0) : "-"}</td><td>${escapeChartHtml(formatDate(contract.endDate || contract.EndDate) || "-")}</td></tr>`;
  }).join("");
  foot.innerHTML = rows.length
    ? `<tr><th colspan="2">الإجمالي</th><th>${fmtBn(total)}</th><th></th><th></th><th></th></tr>`
    : `<tr><th colspan="6">لا توجد بيانات مطابقة للفلاتر الحالية</th></tr>`;
}

function escapeChartHtml(value) {
  return String(value ?? "غير محدد").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function buildInvoiceDisbursementSeries(invoices, getInvoiceNet) {
  const monthly = new Map();
  let minMonth = Infinity;
  let maxMonth = -Infinity;
  const trackMonth = (date) => {
    if (!date) return null;
    const month = date.getFullYear() * 12 + date.getMonth();
    minMonth = Math.min(minMonth, month);
    maxMonth = Math.max(maxMonth, month);
    if (!monthly.has(month)) monthly.set(month, { expected: 0, actual: 0 });
    return monthly.get(month);
  };

  (invoices || []).forEach((invoice) => {
    const net = Math.max(0, Number(getInvoiceNet(invoice)) || 0);
    const paid = Math.max(0, Number(invoice.paidAmount) || 0);
    const expectedMonth = trackMonth(parseDate(invoice.dueDate));
    if (expectedMonth) expectedMonth.expected += net;
    const actualMonth = trackMonth(parseDate(invoice.paymentDate));
    if (actualMonth) actualMonth.actual += paid;

  });

  const labels = [];
  const years = [];
  const expected = [];
  const actual = [];
  if (Number.isFinite(minMonth) && Number.isFinite(maxMonth)) {
    for (let month = minMonth; month <= maxMonth; month += 1) {
      const year = Math.floor(month / 12);
      const monthIndex = month % 12;
      const values = monthly.get(month) || { expected: 0, actual: 0 };
      labels.push(MONTHS[monthIndex]);
      years.push(year);
      expected.push(values.expected);
      actual.push(values.actual);
    }
  }
  const groups = [];
  years.forEach((year, index) => {
    const last = groups[groups.length - 1];
    if (last && last.label === String(year)) last.end = index;
    else groups.push({ label: String(year), start: index, end: index });
  });
  return { labels, years, expected, actual, groups };
}

let invoiceTableSortDir = "asc"; // asc = من الأقدم للأحدث
let invoiceTableSortBound = false;

/** ترتيب المستخلصات حسب تاريخ المستخلص (التواريخ الفارغة دائماً في آخر الجدول) */
function sortInvoicesByDate(invoices, dir) {
  const factor = dir === "desc" ? -1 : 1;
  return [...(invoices || [])]
    .map((invoice, index) => ({ invoice, index, time: parseDate(invoice.date || invoice.Date)?.getTime() ?? null }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return (a.time - b.time) * factor || a.index - b.index;
    })
    .map((entry) => entry.invoice);
}

function bindInvoiceTableSort() {
  const select = document.getElementById("mcInvoiceSortOrder");
  if (!select) return;
  select.value = invoiceTableSortDir;
  if (invoiceTableSortBound) return;
  invoiceTableSortBound = true;
  select.addEventListener("change", () => {
    invoiceTableSortDir = select.value === "desc" ? "desc" : "asc";
    const args = latestDashboardChartArgs;
    if (!args) return;
    renderInvoiceDisbursementTable(args.invoices, args.projectMap, args.contractMap, args.sectorManagers, args.getInvoiceNet, args.fmtNum, args.formatDate);
  });
}

function renderInvoiceDisbursementTable(invoices, projectMap, contractMap, sectorManagers, getInvoiceNet, fmtNum, formatDate = () => "-") {
  const body = document.getElementById("mcDisbursementTableBody");
  const foot = document.getElementById("mcDisbursementTableFoot");
  if (!body || !foot) return;
  const managersById = new Map((sectorManagers || []).map((manager) => [String(manager.id ?? manager.Id ?? "").trim(), manager]));
  const sortedInvoices = sortInvoicesByDate(invoices, invoiceTableSortDir);
  let expectedTotal = 0;
  let actualTotal = 0;
  body.innerHTML = sortedInvoices.map((invoice) => {
    const contract = contractMap.get(invoice.contractId) || {};
    const project = projectMap.get(contract.projectId) || {};
    const managerId = String(project.sectorManagerId ?? project.SectorManagerId ?? "").trim();
    const manager = managersById.get(managerId) || {};
    const expected = Math.max(0, Number(getInvoiceNet(invoice)) || 0);
    const actual = Math.max(0, Number(invoice.paidAmount) || 0);
    expectedTotal += expected;
    actualTotal += actual;
    const managerName = manager.displayName || manager.DisplayName || manager.name || manager.Name || (managerId ? managerId : "غير محدد");
    const projectName = project.name || project.Name || "-";
    const contractName = contract.name || contract.Name || "-";
    const invoiceDate = formatDate(invoice.date || invoice.Date) || "-";
    return `<tr><td title="${escapeChartHtml(projectName)}">${escapeChartHtml(projectName)}</td><td title="${escapeChartHtml(contractName)}">${escapeChartHtml(contractName)}</td><td>${escapeChartHtml(invoice.number || invoice.Number || "-")}</td><td>${escapeChartHtml(invoiceDate)}</td><td>${fmtNum(expected)}</td><td>${fmtNum(actual)}</td><td title="${escapeChartHtml(managerName)}">${escapeChartHtml(managerName)}</td></tr>`;
  }).join("");
  foot.innerHTML = sortedInvoices.length
    ? `<tr><th colspan="4">الإجمالي</th><th>${fmtBn(expectedTotal)}</th><th>${fmtBn(actualTotal)}</th><th></th></tr>`
    : `<tr><th colspan="7">لا توجد مستخلصات مطابقة للفلاتر الحالية</th></tr>`;
}

function renderInvoiceDisbursementCharts({ invoices, projectMap, contractMap, sectorManagers, getInvoiceNet, getInvoiceGross, fmtNum, formatDate }) {
  const pendingCount = (invoices || []).filter((invoice) => {
    const status = String(invoice.paymentStatus || "Pending").trim().toLowerCase();
    return status === "pending" || status === "معلق";
  }).length;
  const pendingCountElement = document.getElementById("mcPendingInvoiceCount");
  if (pendingCountElement) pendingCountElement.textContent = fmtNum(pendingCount, 0);

  bindInvoiceTableSort();
  renderInvoiceDisbursementTable(invoices, projectMap, contractMap, sectorManagers, getInvoiceNet, fmtNum, formatDate);
  const series = buildInvoiceDisbursementSeries(invoices, getInvoiceNet);
  bindInvoiceChartToggle();
  const monthlyCanvas = document.getElementById("mcInvoiceDisbursementChart");
  const monthlyBody = document.getElementById("mcInvoiceDisbursementBody");
  if (monthlyCanvas && monthlyBody && typeof window.Chart !== "undefined") {
    destroyChart("invoiceDisbursementMonthly", monthlyCanvas);
    const inner = monthlyCanvas.parentElement;
    const count = Math.max(series.labels.length, 1);
    const slotWidth = 68;
    if (inner) {
      inner.style.width = `${Math.max(monthlyBody.clientWidth, count * slotWidth)}px`;
      inner.style.height = "100%";
    }
    monthlyCanvas.style.width = "100%";
    monthlyCanvas.style.height = "100%";
    setEmpty(monthlyBody, !series.labels.length);
    const isLineView = invoiceDisbursementChartType === "line";
    const monthlyChart = new window.Chart(monthlyCanvas.getContext("2d"), {
      type: invoiceDisbursementChartType,
      plugins: [valueLabelsPlugin, yearGroupsPlugin],
      data: {
        labels: series.labels.length ? series.labels : [""],
        datasets: [
          { label: "المتوقع صرفه", data: series.expected.length ? series.expected : [0], backgroundColor: COLORS.contract, borderColor: isLineView ? COLORS.contract : "transparent", borderWidth: isLineView ? 3 : 0, borderRadius: 2, tension: 0.32, pointRadius: isLineView ? 4 : 0, pointHoverRadius: isLineView ? 6 : 0, pointBackgroundColor: COLORS.contract, pointBorderColor: "#fff", pointBorderWidth: isLineView ? 2 : 0, categoryPercentage: 0.82, barPercentage: 1, maxBarThickness: isLineView ? undefined : 24, fill: false, clip: false },
          { label: "المنصرف الفعلي", data: series.actual.length ? series.actual : [0], backgroundColor: "#ad4f2a", borderColor: isLineView ? "#ad4f2a" : "transparent", borderWidth: isLineView ? 3 : 0, borderRadius: 2, tension: 0.32, pointRadius: isLineView ? 4 : 0, pointHoverRadius: isLineView ? 6 : 0, pointBackgroundColor: "#ad4f2a", pointBorderColor: "#fff", pointBorderWidth: isLineView ? 2 : 0, categoryPercentage: 0.82, barPercentage: 1, maxBarThickness: isLineView ? undefined : 24, fill: false, clip: false },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 80,
        animation: { duration: 300 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 24, right: 14, bottom: 38, left: 14 } },
        plugins: {
          legend: { display: true, position: "top", align: "center", rtl: true, labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 9, boxHeight: 9, padding: 16, font: { family: FONT, size: 13, weight: "700" } } },
          tooltip: { rtl: true, callbacks: { title: (items) => items?.[0] ? `${series.labels[items[0].dataIndex]} ${series.years[items[0].dataIndex]}` : "", label: (context) => `${context.dataset.label}: ${fmtNum(context.parsed.y || 0)}` } },
          mcValueLabels: { formatter: fmtDisbursementChartValue, fontSize: 12, offset: 5, minBarWidth: 0 },
          mcYearGroups: { groups: series.groups, fontSize: 12 },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, maxRotation: 90, minRotation: 90, padding: 5, color: "#111827", font: { family: FONT, size: 12, weight: "700" } } },
          y: {
            display: invoiceDisbursementChartType === "line",
            beginAtZero: true,
            grace: invoiceDisbursementChartType === "line" ? "24%" : "14%",
            grid: { display: invoiceDisbursementChartType === "line", color: "#e5ebf2" },
            ticks: {
              display: invoiceDisbursementChartType === "line",
              color: "#526579",
              padding: 8,
              font: { family: FONT, size: 11, weight: "600" },
              callback: (value) => fmtDisbursementChartValue(value),
            },
          },
        },
      },
    });
    resizeCurrentInvoiceMonthlyChart = () => {
      const targetWidth = Math.max(monthlyBody.clientWidth, count * 68);
      inner.style.width = `${targetWidth}px`;
      inner.style.height = "100%";
      const targetHeight = inner.clientHeight || monthlyBody.clientHeight;
      monthlyCanvas.style.width = "100%";
      monthlyCanvas.style.height = "100%";
      monthlyChart.resize(targetWidth, targetHeight);
    };
    resizeCurrentInvoiceMonthlyChart();
    invoiceMonthlyResizeObserver?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      invoiceMonthlyResizeObserver = new ResizeObserver(() => resizeCurrentInvoiceMonthlyChart?.());
      invoiceMonthlyResizeObserver.observe(monthlyBody);
    }
    instances.invoiceDisbursementMonthly = monthlyChart;
    requestAnimationFrame(() => {
      if (inner && inner.scrollWidth > monthlyBody.clientWidth) monthlyBody.scrollLeft = monthlyBody.scrollWidth;
    });
  }

  const managerCanvas = document.getElementById("mcManagerDisbursementChart");
  const managerBody = document.getElementById("mcManagerDisbursementBody");
  if (!managerCanvas || !managerBody || typeof window.Chart === "undefined") return;
  destroyChart("managerDisbursement", managerCanvas);
  const managersById = new Map((sectorManagers || []).map((manager) => [String(manager.id ?? manager.Id ?? "").trim(), manager]));
  const managerTotals = new Map();
  (invoices || []).forEach((invoice) => {
    const contract = contractMap.get(invoice.contractId) || {};
    const project = projectMap.get(contract.projectId) || {};
    const managerId = String(project.sectorManagerId ?? project.SectorManagerId ?? "").trim();
    const manager = managersById.get(managerId) || {};
    const key = managerId || "__unassigned";
    const row = managerTotals.get(key) || { label: manager.displayName || manager.DisplayName || manager.name || manager.Name || managerId || "غير محدد", expected: 0, actual: 0 };
    row.expected += Math.max(0, Number(getInvoiceNet(invoice)) || 0);
    row.actual += Math.max(0, Number(invoice.paidAmount) || 0);
    managerTotals.set(key, row);
  });
  const managerRows = [...managerTotals.values()].filter((row) => row.expected || row.actual).sort((a, b) => b.expected - a.expected);
  const managerInner = managerCanvas.parentElement;
  const managerRowHeight = 90;
  if (managerInner) {
    managerInner.style.width = "100%";
    managerInner.style.height = `${Math.max(managerBody.clientHeight, managerRows.length * managerRowHeight + 64)}px`;
  }
  managerCanvas.style.width = "100%";
  managerCanvas.style.height = "100%";
  setEmpty(managerBody, !managerRows.length);
  const managerChart = new window.Chart(managerCanvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: managerRows.length ? managerRows.map((row) => row.label) : [""],
      datasets: [
        { label: "المتوقع صرفه", data: managerRows.length ? managerRows.map((row) => row.expected) : [0], backgroundColor: COLORS.contract, borderWidth: 0, borderRadius: 0, barThickness: 30, maxBarThickness: 32, categoryPercentage: 0.82, barPercentage: 0.9, clip: false },
        { label: "المنصرف الفعلي", data: managerRows.length ? managerRows.map((row) => row.actual) : [0], backgroundColor: "#ad4f2a", borderWidth: 0, borderRadius: 0, barThickness: 30, maxBarThickness: 32, categoryPercentage: 0.82, barPercentage: 0.9, clip: false },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 80,
      animation: { duration: 300 },
      interaction: { mode: "index", axis: "y", intersect: false },
      layout: { padding: { top: 12, right: 58, bottom: 12, left: 8 } },
      plugins: {
        legend: { display: true, position: "top", rtl: true, labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 9, boxHeight: 9, padding: 12, font: { family: FONT, size: 12, weight: "700" } } },
        tooltip: { rtl: true, callbacks: { title: (items) => items?.[0]?.label || "", label: (context) => `${context.dataset.label}: ${fmtNum(context.parsed.x || 0)}` } },
      },
      scales: {
        x: { display: false, beginAtZero: true, grace: "24%", grid: { display: false }, border: { display: false } },
        y: { position: "left", grid: { display: false }, border: { display: false }, ticks: { color: "#111827", padding: 7, autoSkip: false, font: { family: FONT, size: 11, weight: "700" }, callback(value) { const label = String(this.getLabelForValue(value)); return label.length > 18 ? `${label.slice(0, 17)}…` : label; } } },
      },
    },
    plugins: [{
      id: "managerDisbursementValueLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = `700 12px ${FONT}`;
        ctx.fillStyle = "#111827";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        chart.data.datasets.forEach((dataset, datasetIndex) => {
          chart.getDatasetMeta(datasetIndex).data.forEach((bar, index) => {
            const label = fmtDisbursementChartValue(dataset.data[index]);
            if (!label) return;
            const textWidth = ctx.measureText(label).width;
            const x = Math.min(bar.x + 5, chart.width - textWidth - 3);
            ctx.fillText(label, x, bar.y);
          });
        });
        ctx.restore();
      },
    }],
  });
  instances.managerDisbursement = managerChart;
}

/* =====================================================================
 * Public entry point (called from erp.js → renderCharts)
 * ===================================================================== */
export function renderDashboardCharts({
  contracts,
  execPositions,
  getModifiedTotal,
  fmtNum,
  formatDate = () => "-",
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
  latestDashboardChartArgs = {
    contracts: list,
    execPositions,
    getModifiedTotal,
    fmtNum,
    formatDate,
    scopeLabel,
    projectMap,
    ownerMap,
    sectorManagers,
    latestExecutionByContract,
    executionTotal,
    invoices,
    contractMap,
    getInvoiceGross,
    getInvoiceNet,
  };
  renderInvoiceDisbursementCharts({ invoices, projectMap, contractMap, sectorManagers, getInvoiceNet, getInvoiceGross, fmtNum, formatDate });
  renderContractRegisterTable(list, projectMap, fmtNum, formatDate);
  try {
    renderContractValueChart(list, { getModifiedTotal, fmtNum });
  } catch (err) {
    console.error("Contract value chart failed:", err);
  }
  try {
    const byManager = buildContractValueByManager(list, projectMap, sectorManagers);
    renderHorizontalExecutionChart(
      "mcManagerContractChart",
      "mcManagerContractBody",
      byManager,
      fmtNum,
      "قيمة التعاقد",
      COLORS.contract,
    );
  } catch (err) {
    console.error("Contract value by sector manager chart failed:", err);
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

export function resizeDashboardCharts() {
  requestAnimationFrame(() => {
    const activePanel = document.querySelector("[data-dashboard-panel]:not([hidden])");
    if (activePanel && activePanel.getBoundingClientRect().width > 0) {
      const visibleCharts = [...activePanel.querySelectorAll("canvas")]
        .map((canvas) => window.Chart?.getChart?.(canvas))
        .filter(Boolean);
      if (visibleCharts.some((chart) => !chart.width || !chart.height) && latestDashboardChartArgs) {
        renderDashboardCharts(latestDashboardChartArgs);
        return;
      }
    }
    const monthlyChart = instances.invoiceDisbursementMonthly;
    if (monthlyChart) resizeCurrentInvoiceMonthlyChart?.();
    Object.values(instances).forEach((chart) => {
      if (!chart || !chart.canvas?.isConnected || chart === monthlyChart) return;
      const panel = chart.canvas.closest("[data-dashboard-panel]");
      if (panel?.hidden) return;
      const parent = chart.canvas.parentElement;
      if (!parent?.clientWidth || !parent?.clientHeight) return;
      chart.canvas.style.width = "100%";
      chart.canvas.style.height = "100%";
      chart.resize(parent.clientWidth, parent.clientHeight);
    });
    if (execView?.chart && execView.chart.canvas?.isConnected && !execView.chart.canvas.closest("[data-dashboard-panel]")?.hidden) {
      sizeExecInner(execView);
      execView.chart.canvas.style.width = "100%";
      execView.chart.canvas.style.height = "100%";
      execView.chart.resize(execView.inner.clientWidth, execView.inner.clientHeight);
    }
  });
}
