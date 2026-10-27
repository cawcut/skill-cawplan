import { scaleLinear, scaleTime } from "d3-scale";
import { curveMonotoneX, line as d3line } from "d3-shape";
import { extent } from "d3-array";

export interface ChartPoint {
  time: Date;
  value: number;
}

export interface ChartSeries {
  label: string;
  points: ChartPoint[];
}

export interface ChartOptions {
  title?: string;
  yLabel?: string;
  width?: number;
  height?: number;
}

// Colorblind-friendlier categorical palette (Okabe-Ito), cycled when there are
// more series than colors.
const PALETTE = [
  "#0072B2",
  "#D55E00",
  "#009E73",
  "#E69F00",
  "#CC79A7",
  "#56B4E9",
  "#F0E442",
  "#000000",
];

/**
 * Renders one or more time series as a single-file SVG line chart -- no
 * native dependencies (no node-canvas/cairo), so it works anywhere Node runs.
 * Built directly on d3-scale/d3-shape/d3-array (the computational pieces of
 * d3, used here without d3-selection or a DOM/jsdom) rather than a
 * higher-level charting package, since those either require a DOM (most
 * browser-oriented chart libraries) or a native canvas binding (chart.js via
 * chartjs-node-canvas) to produce output outside a browser.
 */
export function renderLineChartSvg(series: ChartSeries[], opts: ChartOptions = {}): string {
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    throw new Error("cannot render a chart with no data points");
  }

  const width = opts.width ?? 960;
  const height = opts.height ?? 480;
  const margin = { top: 48, right: 24, bottom: 48, left: 64 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const [xMin, xMax] = extent(allPoints, (p) => p.time) as [Date, Date];
  const [yMinRaw, yMaxRaw] = extent(allPoints, (p) => p.value) as [number, number];

  // Anchor the y-axis at zero so a line chart of additive metrics (counts,
  // costs) doesn't visually exaggerate small fluctuations the way an
  // auto-zoomed axis would.
  const yMin = Math.min(0, yMinRaw);
  const yMax = yMaxRaw === yMinRaw ? yMaxRaw + 1 : yMaxRaw;

  const xScale = xMin.getTime() === xMax.getTime()
    ? scaleTime().domain([xMin, new Date(xMax.getTime() + 1)]).range([0, innerWidth])
    : scaleTime().domain([xMin, xMax]).range([0, innerWidth]);
  const yScale = scaleLinear().domain([yMin, yMax]).nice().range([innerHeight, 0]);

  const lineGen = d3line<ChartPoint>()
    .x((d) => xScale(d.time))
    .y((d) => yScale(d.value))
    .curve(curveMonotoneX);

  const yTicks = yScale.ticks(5);
  const xTicks = xScale.ticks(Math.min(8, allPoints.length));

  const gridlines = yTicks
    .map(
      (t) =>
        `<line x1="0" y1="${yScale(t)}" x2="${innerWidth}" y2="${yScale(t)}" stroke="#e5e7eb" stroke-width="1"/>`,
    )
    .join("\n    ");

  const yAxisLabels = yTicks
    .map(
      (t) =>
        `<text x="-8" y="${yScale(t)}" dy="0.32em" text-anchor="end" font-size="11" fill="#6b7280">${formatNumber(t)}</text>`,
    )
    .join("\n    ");

  // d3's "nice" tick spacing is chosen to fill ~8 slots across the domain,
  // which for a short-but-multi-day range (e.g. 3 days) can still land on
  // sub-day intervals (every ~9h). A date-only label would then repeat
  // across consecutive ticks that fall on the same calendar day, so decide
  // the label format from the actual gap *between ticks*, not the overall
  // domain span.
  const tickIntervalMs = xTicks.length >= 2 ? xTicks[1].getTime() - xTicks[0].getTime() : spanForTicks(xMin, xMax);
  const xAxisLabels = xTicks
    .map(
      (t) =>
        `<text x="${xScale(t)}" y="${innerHeight + 20}" text-anchor="middle" font-size="11" fill="#6b7280">${formatTick(t, tickIntervalMs)}</text>`,
    )
    .join("\n    ");

  const paths = series
    .map((s, i) => {
      const sorted = [...s.points].sort((a, b) => a.time.getTime() - b.time.getTime());
      const color = PALETTE[i % PALETTE.length];

      // A single-point series's path is just "M x,y" (or "M x,yZ" depending on
      // the curve implementation) -- a moveto with no line segment, which the
      // SVG default stroke-linecap ("butt") renders as literally nothing. Draw
      // a filled circle at every point, not just when there's only one, so a
      // sparse series (the common case right after this metric starts being
      // emitted) is visible instead of producing a technically-valid but
      // blank-looking chart.
      const dots = sorted
        .map((p) => `<circle cx="${xScale(p.time)}" cy="${yScale(p.value)}" r="3" fill="${color}"/>`)
        .join("\n    ");

      const d = sorted.length > 1 ? lineGen(sorted) : null;
      const line = d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>` : "";
      return `${line}\n    ${dots}`;
    })
    .join("\n    ");

  let legendX = 0;
  const legendItems = series
    .map((s, i) => {
      const color = PALETTE[i % PALETTE.length];
      const label = escapeXml(s.label);
      const item = `<g transform="translate(${legendX}, 0)">
        <rect width="10" height="10" y="-9" fill="${color}"/>
        <text x="14" font-size="11" fill="#374151">${label}</text>
      </g>`;
      // Rough width estimate for the next item's x offset -- good enough for
      // a legend, not typeset to the pixel.
      legendX += 24 + label.length * 6.2;
      return item;
    })
    .join("\n    ");

  const title = opts.title
    ? `<text x="${width / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#111827">${escapeXml(opts.title)}</text>`
    : "";

  const yLabel = opts.yLabel
    ? `<text transform="rotate(-90)" x="${-innerHeight / 2}" y="${-margin.left + 16}" text-anchor="middle" font-size="11" fill="#6b7280">${escapeXml(opts.yLabel)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  ${title}
  <g transform="translate(${margin.left}, ${margin.top})">
    ${gridlines}
    ${yAxisLabels}
    ${xAxisLabels}
    ${yLabel}
    <line x1="0" y1="${innerHeight}" x2="${innerWidth}" y2="${innerHeight}" stroke="#9ca3af" stroke-width="1"/>
    ${paths}
  </g>
  <g transform="translate(${margin.left}, ${margin.top - 24})">
    ${legendItems}
  </g>
</svg>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** A month/day label, plus a time-of-day suffix whenever ticks are spaced
 * closer than a day -- without the suffix, e.g. two ticks 12h apart that
 * straddle midnight would print the same "9/1"/"9/2" pair as two ticks a
 * full day apart, and two same-day ticks would print identically. */
function formatTick(d: Date, tickIntervalMs: number): string {
  const date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  if (tickIntervalMs < ONE_DAY_MS) {
    return `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  return date;
}

function spanForTicks(xMin: Date, xMax: Date): number {
  return xMax.getTime() - xMin.getTime();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
