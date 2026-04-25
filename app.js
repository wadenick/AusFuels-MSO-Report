const fuelLabels = {
  gasoline: "Gasoline",
  kerosene: "Jet fuel",
  diesel: "Diesel",
};

const colors = {
  gasoline: "#2563eb",
  kerosene: "#c65d2e",
  diesel: "#3f4652",
  days: "#7b8790",
  grid: "#d8e1e7",
  panel: "#f8fafc",
  panelBorder: "#d7e0e7",
  muted: "#607080",
  ink: "#17212b",
  paper: "#ffffff",
};

const volumeAxis = {
  min: 500,
  max: 3000,
  ticks: [500, 1500, 2500, 3000],
};

const chartLayout = {
  panelHeight: 174,
  panelGap: 94,
  top: 44,
  bottom: 56,
};

let records = [];
let selectedFuel = "all";
let showDaysCover = true;

const formatDate = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const numberFormat = new Intl.NumberFormat("en-AU");

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatPct(value) {
  return `${Math.round(value)}%`;
}

function flatten(data) {
  return data
    .slice()
    .sort((a, b) => parseDate(a.stockDate) - parseDate(b.stockDate))
    .flatMap((week) =>
      Object.entries(week.fuels).map(([fuel, values]) => ({
        fuel,
        fuelName: fuelLabels[fuel] || fuel,
        stockDate: week.stockDate,
        publishedDate: week.publishedDate,
        volumeML: values.volumeML,
        msoRequiredML: values.msoRequiredML,
        daysCover: values.daysCover,
        surplusML: values.volumeML - values.msoRequiredML,
        coverage: (values.volumeML / values.msoRequiredML) * 100,
      })),
    );
}

function latestByFuel() {
  const latestWeek = records.at(-1);
  return Object.entries(latestWeek.fuels).map(([fuel, values]) => ({
    fuel,
    fuelName: fuelLabels[fuel] || fuel,
    ...values,
    surplusML: values.volumeML - values.msoRequiredML,
    coverage: (values.volumeML / values.msoRequiredML) * 100,
  }));
}

function renderHeader() {
  const latestWeek = records.at(-1);
  document.querySelector("#latest-week").textContent = formatDate.format(parseDate(latestWeek.stockDate));
  document.querySelector("#latest-published").textContent =
    `Published ${formatDate.format(parseDate(latestWeek.publishedDate))}`;
}

function renderTabs() {
  const tabs = document.querySelector("#fuel-tabs");
  const fuelOptions = ["all", ...Object.keys(records[0].fuels)];
  tabs.innerHTML = fuelOptions
    .map((fuel) => {
      const label = fuel === "all" ? "All fuels" : fuelLabels[fuel] || fuel;
      return `<button type="button" role="tab" aria-selected="${fuel === selectedFuel}" data-fuel="${fuel}">${label}</button>`;
    })
    .join("");

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-fuel]");
    if (!button) return;
    selectedFuel = button.dataset.fuel;
    render();
  });
}

function renderKpis() {
  const grid = document.querySelector("#kpi-grid");
  grid.innerHTML = latestByFuel()
    .filter((item) => selectedFuel === "all" || item.fuel === selectedFuel)
    .map((item) => {
      const isShort = item.surplusML < 0;
      const delta = `${isShort ? "" : "+"}${numberFormat.format(item.surplusML)} ML`;
      return `
        <article class="kpi-card">
          <div class="kpi-top">
            <span class="kpi-label">${item.fuelName}</span>
            <span class="pill ${isShort ? "alert" : ""}">${isShort ? "Below MSO" : "Above MSO"}</span>
          </div>
          <div class="kpi-value">${numberFormat.format(item.volumeML)} ML</div>
          <p class="kpi-note">${delta} vs MSO · ${formatPct(item.coverage)} coverage · ${item.daysCover} days</p>
        </article>
      `;
    })
    .join("");
}

function renderLegend() {
  document.querySelector("#fuel-legend").innerHTML = visibleFuelKeys()
    .map((fuel) => `<span><i class="legend-${fuel}"></i>${fuelLabels[fuel] || fuel}</span>`)
    .join("");
}

function visibleFuelKeys() {
  if (!records.length) return [];
  return selectedFuel === "all" ? Object.keys(records[0].fuels) : [selectedFuel];
}

function selectedSeries() {
  return visibleFuelKeys().map((fuel) => ({
    fuel,
    fuelName: fuelLabels[fuel] || fuel,
    color: colors[fuel],
    points: records.map((week) => ({
      stockDate: week.stockDate,
      volumeML: week.fuels[fuel].volumeML,
      msoRequiredML: week.fuels[fuel].msoRequiredML,
      daysCover: week.fuels[fuel].daysCover,
    })),
  }));
}

function niceMax(value) {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function drawLine(ctx, points, color, dashPattern = []) {
  ctx.save();
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash(dashPattern);
  ctx.stroke();
  ctx.restore();
}

function drawPoints(ctx, points, color) {
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors.paper;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawChart() {
  if (!records.length) return;
  const canvas = document.querySelector("#volume-chart");
  const series = selectedSeries();
  const wrapHeight =
    chartLayout.top +
    chartLayout.bottom +
    chartLayout.panelHeight * series.length +
    chartLayout.panelGap * Math.max(series.length - 1, 0);
  canvas.parentElement.style.height = `${wrapHeight}px`;

  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.scale(ratio, ratio);

  const width = rect.width;
  const pad = { top: chartLayout.top, right: showDaysCover ? 56 : 22, bottom: chartLayout.bottom, left: 72 };
  const panelGap = chartLayout.panelGap;
  const panelH = chartLayout.panelHeight;
  const plotW = width - pad.left - pad.right;
  const x = (index) => pad.left + (records.length === 1 ? plotW / 2 : (index / (records.length - 1)) * plotW);

  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.textBaseline = "middle";

  series.forEach((item, panelIndex) => {
    const panelTop = pad.top + panelIndex * (panelH + panelGap);
    const panelBottom = panelTop + panelH;
    const cardX = 14;
    const cardY = panelTop - 38;
    const cardW = width - 28;
    const cardH = panelH + 82;
    const maxDays = niceMax(Math.max(...item.points.map((point) => point.daysCover)) * 1.15);
    const yVolume = (value) =>
      panelBottom - ((value - volumeAxis.min) / (volumeAxis.max - volumeAxis.min)) * panelH;
    const yDays = (value) => panelBottom - (value / maxDays) * panelH;

    ctx.save();
    roundedRect(ctx, cardX, cardY, cardW, cardH, 8);
    ctx.fillStyle = colors.panel;
    ctx.fill();
    ctx.strokeStyle = colors.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = item.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.fillText(item.fuelName, pad.left, panelTop - 12);

    ctx.fillStyle = colors.muted;
    ctx.textAlign = "right";
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.fillText("ML", pad.left - 10, panelTop - 12);
    if (showDaysCover) {
      ctx.textAlign = "left";
      ctx.fillText("Days", width - pad.right + 10, panelTop - 12);
    }

    ctx.textBaseline = "middle";
    volumeAxis.ticks.forEach((value) => {
      const y = yVolume(value);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.strokeStyle = colors.grid;
      ctx.stroke();
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "right";
      ctx.fillText(numberFormat.format(Math.round(value)), pad.left - 10, y);
    });

    if (showDaysCover) {
      for (let tick = 0; tick <= 2; tick += 1) {
        const value = (maxDays / 2) * tick;
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "left";
        ctx.fillText(Math.round(value), width - pad.right + 10, yDays(value));
      }
    }

    const stockPoints = item.points.map((point, index) => ({ x: x(index), y: yVolume(point.volumeML) }));
    const msoPoints = item.points.map((point, index) => ({ x: x(index), y: yVolume(point.msoRequiredML) }));
    const daysPoints = item.points.map((point, index) => ({ x: x(index), y: yDays(point.daysCover) }));

    drawLine(ctx, msoPoints, item.color, [8, 7]);
    drawLine(ctx, stockPoints, item.color);
    drawPoints(ctx, stockPoints, item.color);

    if (showDaysCover) {
      ctx.save();
      ctx.globalAlpha = 0.65;
      drawLine(ctx, daysPoints, item.color, [2, 7]);
      ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = colors.muted;
    ctx.font = "12px Inter, system-ui, sans-serif";
    records.forEach((week, index) => {
      const label = formatDate.format(parseDate(week.stockDate)).replace(" 2026", "");
      ctx.fillText(label, x(index), panelBottom + 22);
    });
  });
}

function renderTable() {
  const rows = flatten(records)
    .filter((row) => selectedFuel === "all" || row.fuel === selectedFuel)
    .sort((a, b) => parseDate(b.stockDate) - parseDate(a.stockDate));

  document.querySelector("#data-table").innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${formatDate.format(parseDate(row.stockDate))}</td>
          <td>${row.fuelName}</td>
          <td>${numberFormat.format(row.volumeML)}</td>
          <td>${numberFormat.format(row.msoRequiredML)}</td>
          <td class="${row.surplusML >= 0 ? "positive" : "negative"}">${row.surplusML >= 0 ? "+" : ""}${numberFormat.format(row.surplusML)}</td>
          <td>${formatPct(row.coverage)}</td>
          <td>${row.daysCover}</td>
        </tr>
      `,
    )
    .join("");
}

function renderSubtitle() {
  const label = selectedFuel === "all" ? "separate mini chart per fuel" : fuelLabels[selectedFuel].toLowerCase();
  document.querySelector("#chart-subtitle").textContent = `Stock and MSO levels by stock date for ${label}`;
  document.querySelector("#show-days-cover").checked = showDaysCover;
}

function render() {
  document.querySelectorAll("#fuel-tabs button").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.fuel === selectedFuel));
  });
  renderSubtitle();
  renderKpis();
  renderLegend();
  drawChart();
  renderTable();
}

async function init() {
  const response = await fetch("data/fuels.json");
  if (!response.ok) throw new Error(`Could not load fuel data: ${response.status}`);
  records = (await response.json()).sort((a, b) => parseDate(a.stockDate) - parseDate(b.stockDate));
  renderHeader();
  renderTabs();
  render();
}

document.querySelector("#show-days-cover").addEventListener("change", (event) => {
  showDaysCover = event.target.checked;
  render();
});

window.addEventListener("resize", drawChart);

init().catch((error) => {
  document.body.innerHTML = `<main class="shell"><h1>Unable to load dashboard</h1><p class="lede">${error.message}</p></main>`;
});
