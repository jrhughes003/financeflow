// One chart theme, applied everywhere.
//
// Recharts' defaults are the chart equivalent of the interface this replaced:
// full grids, boxed legends, saturated primaries, a white tooltip with a hard
// border. The rules here match the rest of the system — the data carries the
// colour, the chrome stays quiet, and every figure is tabular.
//
// Values are CSS variables, so charts follow a theme swap like everything else.

export const CHART_COLORS = [
  'var(--c-data-1)', 'var(--c-data-2)', 'var(--c-data-3)', 'var(--c-data-4)',
  'var(--c-data-5)', 'var(--c-data-6)', 'var(--c-data-7)',
];

export const SERIES = {
  primary: 'var(--c-data-1)',
  secondary: 'var(--c-data-3)',
  positive: 'var(--c-positive)',
  negative: 'var(--c-negative)',
  caution: 'var(--c-caution)',
  muted: 'var(--c-line-strong)',
};

/* Horizontal rules only: vertical gridlines add ink without adding meaning. */
export const grid = {
  stroke: 'var(--c-line-faint)',
  strokeDasharray: '0',
  vertical: false,
};

/* Axes lose their spines — the gridlines already imply the scale. */
export const axis = {
  tick: { fill: 'var(--c-ink-muted)', fontSize: 11, fontFamily: 'var(--font-numeric)' },
  tickLine: false,
  axisLine: false,
};

export const xAxis = { ...axis, dy: 4 };
export const yAxis = { ...axis, width: 56 };

/* Compact axis labels: $1.2k reads faster than $1,234 on a tick. */
export function compactMoney(value: number | string): string {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
}

export const tooltip = {
  cursor: { fill: 'var(--c-surface-hover)' },
  contentStyle: {
    background: 'var(--c-surface)',
    border: '1px solid var(--c-line)',
    borderRadius: 'var(--r-container)',
    boxShadow: 'var(--shadow-overlay)',
    fontSize: 12,
    padding: '8px 10px',
  },
  labelStyle: { color: 'var(--c-ink-muted)', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' },
  itemStyle: { color: 'var(--c-ink)', fontFamily: 'var(--font-numeric)', padding: '1px 0' },
};

export const legend = {
  iconType: 'plainline',
  iconSize: 10,
  wrapperStyle: { fontSize: 12, color: 'var(--c-ink-secondary)', paddingTop: 8 },
};
