// The primitives every page is built from.
//
// Before this file, styling lived in long className strings copied between
// components, which is how an interface ends up with one radius, one blue and a
// shadow under everything. Changing the look now means changing a token or a
// component here — not finding forty occurrences of `rounded-2xl shadow-sm`.

import React from 'react';
import { getDisplayCurrency, localeFor } from '../../utils/calculations';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* -------------------------------------------------------------------------
 * Surface — a panel. Hairline border, no shadow: elevation is for overlays.
 * ---------------------------------------------------------------------- */
export function Card({ children, className = '', padded = true, as: Tag = 'div', ...rest }) {
  return (
    <Tag
      className={cx('bg-surface border border-line rounded-container', padded && 'p-5', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* A card's heading row: title on the left, actions on the right. */
export function CardHeader({ title, subtitle, children, className = '' }) {
  return (
    <div className={cx('flex items-start justify-between gap-4 mb-4', className)}>
      <div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-caption text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Button — four intents, one shape. Tight radius; the accent is evergreen.
 * ---------------------------------------------------------------------- */
const BUTTON_VARIANTS = {
  primary: 'bg-accent text-ink-inverse hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink border border-transparent',
  danger: 'bg-transparent text-negative border border-transparent hover:bg-negative-tint',
};

const BUTTON_SIZES = {
  sm: 'h-7 px-2.5 text-caption gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-10 px-4 text-base gap-2',
};

export function Button({
  children, variant = 'secondary', size = 'md', icon: Icon, className = '', ...rest
}) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center rounded-control font-medium',
        'transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className,
      )}
      {...rest}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* Icon-only button. Always takes a label — these were unlabelled before. */
export function IconButton({ icon: Icon, label, variant = 'ghost', className = '', ...rest }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center w-7 h-7 rounded-control transition-colors',
        BUTTON_VARIANTS[variant], className,
      )}
      {...rest}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Money — every figure in the app goes through here.
 *
 * Tabular mono so decimals line up in a column; the currency symbol set a step
 * lighter than the value, which is the convention finance products share.
 * Colour is applied only when the sign carries meaning — a total isn't green
 * just because it exists.
 * ---------------------------------------------------------------------- */
export function Money({
  value, currency, locale, signed = false, colour = false,
  size = 'base', className = '', decimals = 2,
}) {
  // Defaulting to CAD here while formatCurrency() read settings.currency meant
  // the same page could print one figure as en-CA and the next as en-US. Both
  // render a bare "$", so it stayed invisible — which is exactly why it needs
  // one source rather than two.
  const ccy = currency || getDisplayCurrency();
  const amount = Number(value) || 0;
  const formatted = new Intl.NumberFormat(locale || localeFor(ccy), {
    style: 'currency', currency: ccy,
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(Math.abs(amount));

  // Split so the symbol can be de-emphasised without losing copy-paste.
  const symbol = formatted.replace(/[\d.,\s]/g, '');
  const digits = formatted.replace(/[^\d.,]/g, '');

  const tone = !colour ? '' : amount > 0 ? 'text-positive' : amount < 0 ? 'text-negative' : '';
  const sizes = {
    display: 'figure-display',
    lg: 'text-xl font-medium',
    base: 'text-base',
    sm: 'text-sm',
    caption: 'text-caption',
  };

  return (
    <span className={cx('money whitespace-nowrap', sizes[size], tone, className)}>
      {amount < 0 && '−'}
      {signed && amount > 0 && '+'}
      <span className="opacity-55">{symbol}</span>
      {digits}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Stat — a labelled figure. One per page should be `prominent`; the rest
 * support it. Four equal tiles is the pattern this replaces.
 * ---------------------------------------------------------------------- */
export function Stat({ label, children, hint, prominent = false, className = '' }) {
  return (
    <div className={className}>
      <p className="label-micro">{label}</p>
      <div className={cx('mt-1.5', prominent ? '' : 'text-xl font-medium text-ink')}>{children}</div>
      {hint && <p className="text-caption text-ink-muted mt-1">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Badge — status, not decoration. Square-ish, ink-toned, never pastel.
 * ---------------------------------------------------------------------- */
const BADGE_TONES = {
  neutral: 'bg-surface-sunk text-ink-secondary border-line',
  positive: 'bg-positive-tint text-positive border-transparent',
  negative: 'bg-negative-tint text-negative border-transparent',
  caution: 'bg-caution-tint text-caution border-transparent',
  accent: 'bg-accent-tint text-accent-ink border-transparent',
};

export function Badge({ children, tone = 'neutral', className = '' }) {
  return (
    <span className={cx(
      'inline-flex items-center px-1.5 py-0.5 rounded-control border',
      'text-micro font-medium uppercase tracking-[0.06em]',
      BADGE_TONES[tone], className,
    )}>
      {children}
    </span>
  );
}

/* A category marker: a small square of the category's colour, not a pill. */
export function CategoryMark({ color, name, className = '' }) {
  return (
    <span className={cx('inline-flex items-center gap-2 min-w-0', className)}>
      <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: color }} aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Table — ruled rows rather than a card per record, so more ledger fits on
 * screen. Numeric columns right-align; headers are quiet.
 * ---------------------------------------------------------------------- */
export function Table({ children, className = '' }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx('w-full text-sm', className)}>{children}</table>
    </div>
  );
}

export function Th({ children, numeric = false, className = '', ...rest }) {
  return (
    <th
      scope="col"
      className={cx(
        'label-micro font-medium py-2 px-3 border-b border-line bg-surface-sunk',
        numeric ? 'text-right' : 'text-left', className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ children, numeric = false, className = '', ...rest }) {
  return (
    <td
      className={cx('py-0 px-3 h-row border-b border-line-faint align-middle',
        numeric ? 'text-right' : 'text-left', className)}
      {...rest}
    >
      {children}
    </td>
  );
}

export function Tr({ children, className = '', ...rest }) {
  return <tr className={cx('hover:bg-surface-hover transition-colors', className)} {...rest}>{children}</tr>;
}

/* -------------------------------------------------------------------------
 * Meter — budget progress. A rule, not a rounded capsule.
 * ---------------------------------------------------------------------- */
export function Meter({ value, max, tone = 'accent', className = '' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;
  const fill = over ? 'bg-negative' : tone === 'accent' ? 'bg-accent' : `bg-${tone}`;
  return (
    <div className={cx('h-1 bg-line-faint rounded-pill overflow-hidden', className)} role="presentation">
      <div className={cx('h-full rounded-pill transition-[width] duration-300', fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* A page's opening block: the figure it is about, then its supporting cast. */
export function PageLede({ label, children, supporting, className = '' }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-6', className)}>
      <div>
        <p className="label-micro">{label}</p>
        <div className="mt-2">{children}</div>
      </div>
      {supporting && (
        <div className="flex items-end gap-8">{supporting}</div>
      )}
    </div>
  );
}
