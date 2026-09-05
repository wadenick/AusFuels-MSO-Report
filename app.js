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
  price: "#0f766e",
  grid: "#d8e1e7",
  panel: "#f8fafc",
  panelBorder: "#d7e0e7",
  muted: "#607080",
  ink: "#17212b",
  paper: "#ffffff",
};

const volumeAxis = {
  gasoline: {
    min: 500,
    max: 3000,
    ticks: [500, 1500, 2500, 3000],
  },
  kerosene: {
    min: 0,
    max: 2500,
    ticks: [0, 1000, 2000, 2500],
  },
  diesel: {
    min: 1000,
    max: 3500,
    ticks: [1000, 2000, 3000, 3500],
  },
};

const chartLayout = {
  panelHeight: 174,
  pricePanelGap: 206,
  standardPanelGap: 88,
  top: 44,
  priceBottom: 186,
  standardBottom: 68,
  priceBandHeight: 84,
  dieselBottomPadding: 6,
};

let records = [];
let priceRecords = [];
let aviationPrices = [];
let priceMeta = null;
let selectedFuel = "all";
let showDaysCover = true;
let chartHitTargets = [];

const formatDate = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const numberFormat = new Intl.NumberFormat("en-AU");
const priceFormat = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const monthFormat = new Intl.DateTimeFormat("en-AU", {
  month: "short",
});

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatPct(value) {
  return `${Math.round(value)}%`;
}

function priceFor(fuel, stockDate) {
  if (!["gasoline", "diesel"].includes(fuel) || !priceRecords.length) return null;

  const target = parseDate(stockDate);
  return priceRecords
    .filter((record) => parseDate(record.date) <= target && record[fuel]?.priceCpl)
    .sort((a, b) => parseDate(b.date) - parseDate(a.date))[0]?.[fuel] ?? null;
}

function aviationPriceFor(fuel, stockDate) {
  if (fuel !== "kerosene" || !aviationPrices.length) return null;

  const targetMonth = stockDate.slice(0, 7);
  const observation = aviationPrices.find(
    (record) =>
      record.month === targetMonth &&
      Number.isFinite(record.jetA1) &&
      Number.isFinite(record.avgas100LL),
  );

  return observation
    ? {
        jetA1Cpl: observation.jetA1 * 100,
        avgas100LLCpl: observation.avgas100LL * 100,
        month: observation.month,
      }
    : null;
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
        price: priceFor(fuel, week.stockDate),
        aviationPrice: aviationPriceFor(fuel, week.stockDate),
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
  const hasPrices = visibleFuelKeys().some((fuel) => ["gasoline", "diesel"].includes(fuel));
  document.querySelector("#fuel-legend").innerHTML = visibleFuelKeys()
    .map((fuel) => `<span><i class="legend-${fuel}"></i>${fuelLabels[fuel] || fuel}</span>`)
    .join("");
  document.querySelector("#price-legend").hidden = !hasPrices;
  document.querySelector("#aviation-source").hidden = !visibleFuelKeys().includes("kerosene") || !aviationPrices.length;
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
      price: priceFor(fuel, week.stockDate),
    })),
  }));
}

function niceMax(value) {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function monthlyTickIndexes() {
  const ticksByMonth = new Map();

  records.forEach((week, index) => {
    const date = parseDate(week.stockDate);
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    const distanceFromMidMonth = Math.abs(date.getDate() - 15);
    const current = ticksByMonth.get(monthKey);

    if (!current || distanceFromMidMonth < current.distanceFromMidMonth) {
      ticksByMonth.set(monthKey, { index, distanceFromMidMonth });
    }
  });

  return [...ticksByMonth.values()].map(({ index }) => index);
}

function niceStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function priceAxis(values, minimumStep = 0, maximumTick = Infinity) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const step = Math.max(niceStep(Math.max(dataMax - dataMin, 1) / 4), minimumStep);
  const minDomainStep = minimumStep ? minimumStep / 5 : step;
  const maxDomainStep = Number.isFinite(maximumTick) ? step / 5 : minDomainStep;
  const min = Math.floor(dataMin / minDomainStep) * minDomainStep;
  const max = Math.max(
    Math.ceil(dataMax / maxDomainStep) * maxDomainStep,
    Number.isFinite(maximumTick) ? maximumTick : -Infinity,
  );
  const ticks = [];

  for (
    let value = Math.ceil(min / step) * step;
    value <= Math.min(max, maximumTick) + step / 2;
    value += step
  ) {
    ticks.push(value);
  }

  return { min, max: Math.max(max, min + step), ticks };
}

function drawLine(ctx, points, color, dashPattern = [], width = 3) {
  ctx.save();
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashPattern);
  ctx.stroke();
  ctx.restore();
}

function drawPoints(ctx, points, color, radius = 4) {
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
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
  chartHitTargets = [];
  const series = selectedSeries();
  let nextPanelTop = chartLayout.top;
  const panelLayouts = series.map((item) => {
    const hasPriceBand = item.fuel === "kerosene" ? aviationPrices.length > 0 : item.points.filter((point) => point.price).length > 1;
    const bottomPadding = ["kerosene", "diesel"].includes(item.fuel) ? chartLayout.dieselBottomPadding : 0;
    const layout = { top: nextPanelTop, hasPriceBand, bottomPadding };
    nextPanelTop +=
      chartLayout.panelHeight +
      (hasPriceBand ? chartLayout.pricePanelGap : chartLayout.standardPanelGap) +
      bottomPadding;
    return layout;
  });
  const lastPanel = panelLayouts.at(-1);
  const wrapHeight =
    lastPanel.top +
    chartLayout.panelHeight +
    (lastPanel.hasPriceBand ? chartLayout.priceBottom : chartLayout.standardBottom) +
    lastPanel.bottomPadding;
  canvas.parentElement.style.height = `${wrapHeight}px`;

  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.scale(ratio, ratio);

  const width = rect.width;
  const pad = { right: showDaysCover ? 56 : 22, left: 72 };
  const panelH = chartLayout.panelHeight;
  const plotW = width - pad.left - pad.right;
  const x = (index) => pad.left + (records.length === 1 ? plotW / 2 : (index / (records.length - 1)) * plotW);
  const xForDate = (dateValue) => {
    const target = parseDate(dateValue).getTime();
    const dates = records.map((record) => parseDate(record.stockDate).getTime());
    if (target <= dates[0]) return x(0);
    if (target >= dates.at(-1)) return x(records.length - 1);

    const upperIndex = dates.findIndex((date) => date >= target);
    const lowerIndex = upperIndex - 1;
    const fraction = (target - dates[lowerIndex]) / (dates[upperIndex] - dates[lowerIndex]);
    return x(lowerIndex + fraction);
  };
  const monthTicks = monthlyTickIndexes();

  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.lineWidth = 1;
  ctx.textBaseline = "middle";

  series.forEach((item, panelIndex) => {
    const panelLayout = panelLayouts[panelIndex];
    const panelTop = panelLayout.top;
    const panelGap =
      (panelLayout.hasPriceBand ? chartLayout.pricePanelGap : chartLayout.standardPanelGap) +
      panelLayout.bottomPadding;
    const panelBottom = panelTop + panelH;
    const cardX = 14;
    const cardY = panelTop - 38;
    const cardW = width - 28;
    const cardH = panelH + panelGap - 6;
    const axis = volumeAxis[item.fuel] ?? volumeAxis.gasoline;
    const maxDays = niceMax(Math.max(...item.points.map((point) => point.daysCover)) * 1.15);
    const prices = item.points.map((point) => point.price?.priceCpl).filter(Boolean);
    const tgpAxis = prices.length
      ? priceAxis(
          prices,
          item.fuel === "gasoline" ? 50 : 0,
          ["gasoline", "diesel"].includes(item.fuel) ? 300 : Infinity,
        )
      : { min: 0, max: 1, ticks: [] };
    const yVolume = (value) =>
      panelBottom - ((value - axis.min) / (axis.max - axis.min)) * panelH;
    const yDays = (value) => panelBottom - (value / maxDays) * panelH;
    const priceBandTop = panelBottom + 72;
    const priceBandH = chartLayout.priceBandHeight;
    const yPrice = (value) =>
      priceBandTop + priceBandH - ((value - tgpAxis.min) / (tgpAxis.max - tgpAxis.min)) * priceBandH;

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
    axis.ticks.forEach((value) => {
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

    stockPoints.forEach((chartPoint, index) => {
      const point = item.points[index];
      chartHitTargets.push({
        x: chartPoint.x,
        y: chartPoint.y,
        color: item.color,
        fuelName: item.fuelName,
        stockDate: point.stockDate,
        volumeML: point.volumeML,
        msoRequiredML: point.msoRequiredML,
        daysCover: point.daysCover,
        price: point.price,
        surplusML: point.volumeML - point.msoRequiredML,
      });
    });

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
    monthTicks.forEach((index) => {
      const date = parseDate(records[index].stockDate);
      ctx.beginPath();
      ctx.moveTo(x(index), panelBottom + 5);
      ctx.lineTo(x(index), panelBottom + 11);
      ctx.strokeStyle = colors.grid;
      ctx.stroke();
      const label = monthFormat.format(date);
      ctx.fillText(label, x(index), panelBottom + 22);
    });

    if (item.fuel === "kerosene" && aviationPrices.length) {
      drawAviationPrices(ctx, pad.left, width - pad.right, priceBandTop, priceBandH, xForDate);
    }

    if (prices.length > 1) {
      const pricePoints = item.points
        .map((point, index) =>
          point.price
            ? {
                x: x(index),
                y: yPrice(point.price.priceCpl),
                stockDate: point.stockDate,
                price: point.price,
              }
            : null,
        )
        .filter(Boolean);
      ctx.save();
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.font = "600 10px Inter, system-ui, sans-serif";
      ctx.fillText("Sydney TGP (c/L)", pad.left, priceBandTop - 9);

      ctx.textBaseline = "middle";
      ctx.font = "10px Inter, system-ui, sans-serif";
      tgpAxis.ticks.forEach((value) => {
        const y = yPrice(value);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.strokeStyle = colors.grid;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "right";
        ctx.fillText(numberFormat.format(value), pad.left - 10, y);
      });

      drawLine(ctx, pricePoints, colors.price, [1, 6], 2);
      drawPoints(ctx, pricePoints, colors.price, 2);
      pricePoints.forEach((point) => {
        chartHitTargets.push({
          x: point.x,
          y: point.y,
          priceTrend: true,
          color: colors.price,
          fuelName: item.fuelName,
          stockDate: point.stockDate,
          price: point.price,
        });
      });
      ctx.restore();
    }
  });
}

function drawAviationPrices(ctx, left, right, top, height, xForDate) {
  const axis = { min: 200, max: 350, ticks: [200, 250, 300, 350] };
  const yCents = (value) => top + height - (value - axis.min) / (axis.max - axis.min) * height;
  const y = (value) => yCents(value * 100);
  const monthLabel = (month) => new Intl.DateTimeFormat("en-AU", {month: "short", year: "numeric"}).format(parseDate(`${month}-01`));
  ctx.save();
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.fillText("Shellharbour retail (c/L) · monthly", left, top - 9);
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  axis.ticks.forEach((value) => {
    ctx.beginPath();
    ctx.moveTo(left, yCents(value));
    ctx.lineTo(right, yCents(value));
    ctx.strokeStyle = colors.grid;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.textAlign = "right";
    ctx.fillText(numberFormat.format(value), left - 10, yCents(value));
  });
  [
    {key: "jetA1", label: "Jet A1", color: colors.price},
    {key: "avgas100LL", label: "Avgas 100LL", color: "#9333a8"},
  ].forEach(({key, label, color}) => {
    const points = aviationPrices.map((record) => ({x: xForDate(`${record.month}-01`), y: y(record[key])}));
    drawLine(ctx, points, color, [1, 6], 2);
    drawPoints(ctx, points, color, 2);
    points.forEach((point, i) => chartHitTargets.push({
      ...point, aviation: true, color, fuelName: label,
      month: monthLabel(aviationPrices[i].month), value: aviationPrices[i][key],
    }));
  });
  ctx.restore();
}

function hideChartTooltip() {
  const tooltip = document.querySelector("#chart-tooltip");
  tooltip.style.display = "none";
}

function renderChartTooltip(event) {
  const canvas = document.querySelector("#volume-chart");
  const tooltip = document.querySelector("#chart-tooltip");
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = canvas.parentElement.getBoundingClientRect();
  const pointer = {
    x: event.clientX - canvasRect.left,
    y: event.clientY - canvasRect.top,
  };
  const nearest = chartHitTargets
    .map((target) => ({
      target,
      distance: Math.hypot(target.x - pointer.x, target.y - pointer.y),
    }))
    .filter((item) => item.distance <= 12)
    .sort((a, b) => a.distance - b.distance)[0]?.target;

  if (!nearest) {
    hideChartTooltip();
    canvas.style.cursor = "default";
    return;
  }

  const delta = `${nearest.surplusML >= 0 ? "+" : ""}${numberFormat.format(nearest.surplusML)} ML`;
  const priceLine = nearest.price
    ? `<span>${nearest.price.label}: ${priceFormat.format(nearest.price.priceCpl)} c/L</span>`
    : "";
  tooltip.innerHTML = nearest.aviation
    ? `
      <strong style="color: ${nearest.color}">${nearest.fuelName}</strong>
      <span>${nearest.month} · ${(nearest.value * 100).toFixed(1)} c/L</span>
      <span>Shellharbour Airport retail</span>
    `
    : nearest.priceTrend
      ? `
        <strong style="color: ${nearest.color}">${nearest.fuelName}</strong>
        <span>${formatDate.format(parseDate(nearest.stockDate))} · ${priceFormat.format(nearest.price.priceCpl)} c/L</span>
        <span>${nearest.price.label}</span>
      `
      : `
    <strong style="color: ${nearest.color}">${nearest.fuelName} · ${formatDate.format(parseDate(nearest.stockDate))}</strong>
    <span>Stock: ${numberFormat.format(nearest.volumeML)} ML</span>
    <span>MSO: ${numberFormat.format(nearest.msoRequiredML)} ML</span>
    <span>Surplus: ${delta}</span>
    <span>Days cover: ${nearest.daysCover}</span>
    ${priceLine}
    `;
  tooltip.style.display = "block";

  const left = event.clientX - wrapRect.left + 14;
  const top = event.clientY - wrapRect.top + 14;
  const maxLeft = wrapRect.width - tooltip.offsetWidth - 8;
  const maxTop = wrapRect.height - tooltip.offsetHeight - 8;
  tooltip.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(top, maxTop))}px`;
  canvas.style.cursor = "pointer";
}

function sparklinePath(points) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

function renderSparkline(row) {
  const width = 124;
  const height = 34;
  const pad = { x: 5, y: 5 };
  const rowDate = parseDate(row.stockDate);
  const weeks = records
    .filter((week) => parseDate(week.stockDate) <= rowDate)
    .map((week) => ({
      stockDate: week.stockDate,
      volumeML: week.fuels[row.fuel].volumeML,
      msoRequiredML: week.fuels[row.fuel].msoRequiredML,
    }));
  const values = weeks.flatMap((week) => [week.volumeML, week.msoRequiredML]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const x = (index) => pad.x + (weeks.length === 1 ? (width - pad.x * 2) / 2 : (index / (weeks.length - 1)) * (width - pad.x * 2));
  const y = (value) => height - pad.y - ((value - min) / span) * (height - pad.y * 2);
  const stockPoints = weeks.map((week, index) => ({ x: x(index), y: y(week.volumeML) }));
  const msoPoints = weeks.map((week, index) => ({ x: x(index), y: y(week.msoRequiredML) }));
  const currentIndex = weeks.findIndex((week) => week.stockDate === row.stockDate);
  const currentPoint = stockPoints[currentIndex] ?? stockPoints.at(-1);
  const color = colors[row.fuel];
  const label = `${row.fuelName} stock trend, current row ${numberFormat.format(row.volumeML)} ML`;

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
      <path class="sparkline-mso" d="${sparklinePath(msoPoints)}"></path>
      <path class="sparkline-stock" style="stroke: ${color}" d="${sparklinePath(stockPoints)}"></path>
      <circle class="sparkline-point" style="fill: ${color}" cx="${currentPoint.x.toFixed(1)}" cy="${currentPoint.y.toFixed(1)}" r="3"></circle>
    </svg>
  `;
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
          <td class="trend-cell">${renderSparkline(row)}</td>
          <td>${numberFormat.format(row.volumeML)}</td>
          <td>${numberFormat.format(row.msoRequiredML)}</td>
          <td class="${row.surplusML >= 0 ? "positive" : "negative"}">${row.surplusML >= 0 ? "+" : ""}${numberFormat.format(row.surplusML)}</td>
          <td>${formatPct(row.coverage)}</td>
          <td>${row.daysCover}</td>
          <td>${row.price ? `${priceFormat.format(row.price.priceCpl)} c/L` : "—"}</td>
          <td>${row.aviationPrice ? `${priceFormat.format(row.aviationPrice.jetA1Cpl)} c/L` : "—"}</td>
          <td>${row.aviationPrice ? `${priceFormat.format(row.aviationPrice.avgas100LLCpl)} c/L` : "—"}</td>
        </tr>
      `,
    )
    .join("");
}

function renderSubtitle() {
  const label = selectedFuel === "all" ? "separate mini chart per fuel" : fuelLabels[selectedFuel].toLowerCase();
  const priceContext = visibleFuelKeys().some((fuel) => ["gasoline", "diesel"].includes(fuel))
    ? ", with Sydney TGP overlay"
    : "";
  const aviationContext = visibleFuelKeys().includes("kerosene") && aviationPrices.length ? "; Shellharbour monthly retail aviation prices" : "";
  document.querySelector("#chart-subtitle").textContent = `Stock and MSO levels by stock date for ${label}${priceContext}${aviationContext}`;
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
  const priceResponse = await fetch("data/prices.json").catch(() => null);
  if (priceResponse?.ok) {
    priceMeta = await priceResponse.json();
    priceRecords = (priceMeta.prices ?? []).sort((a, b) => parseDate(a.date) - parseDate(b.date));
  }
  const aviationResponse = await fetch("data/aviation-prices.json").catch(() => null);
  if (aviationResponse?.ok) {
    aviationPrices = ((await aviationResponse.json()).prices ?? []).sort((a, b) => a.month.localeCompare(b.month));
  }
  records = (await response.json()).sort((a, b) => parseDate(a.stockDate) - parseDate(b.stockDate));
  renderHeader();
  renderTabs();
  render();
}

document.querySelector("#show-days-cover").addEventListener("change", (event) => {
  showDaysCover = event.target.checked;
  render();
});

document.querySelector("#volume-chart").addEventListener("pointermove", renderChartTooltip);
document.querySelector("#volume-chart").addEventListener("pointerleave", hideChartTooltip);

window.addEventListener("resize", drawChart);

init().catch((error) => {
  document.body.innerHTML = `<main class="shell"><h1>Unable to load dashboard</h1><p class="lede">${error.message}</p></main>`;
});
