// The primitives every page is built from.
//
// Before this file, styling lived in long className strings copied between
// components, which is how an interface ends up with one radius, one blue and a
// shadow under everything. Changing the look now means changing a token or a
// component here — not finding forty occurrences of `rounded-2xl shadow-sm`.
//
// The look is a trading terminal: square panels on a hairline grid, a title
// bar on each, mono figures, 24px rows. See src/styles/tokens.css.

import React, { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { getDisplayCurrency, localeFor } from '../../utils/calculations';

type ClassPart = string | false | null | undefined;
/** Four intents, one shape. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type MoneySize = 'display' | 'lg' | 'base' | 'sm' | 'caption';

/** Status colours. Colour belongs to data, so these carry meaning, not decoration. */
export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'caution' | 'accent';

const cx = (...parts: ClassPart[]): string => parts.filter(Boolean).join(' ');

/* -------------------------------------------------------------------------
 * Card — a plain panel. Hairline border, no shadow, square.
 * ---------------------------------------------------------------------- */
export function Card({
  children, className = '', padded = true, as: Tag = 'div', ...rest
}: React.HTMLAttributes<HTMLElement> & {
  padded?: boolean;
  /** Render as a different element when the panel is a section or an article. */
  as?: React.ElementType;
}) {
  return (
    <Tag
      className={cx('bg-surface border border-line rounded-container', padded && 'p-3', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* A card's heading row: title on the left, actions on the right, a rule under. */
export function CardHeader({
  title, subtitle, children, className = '',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Actions, shown on the right of the heading row. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-3 mb-3 pb-2 border-b border-line', className)}>
      <div className="min-w-0">
        <h2 className="text-micro uppercase font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-caption text-ink-muted mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-1.5 shrink-0">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Panel — the terminal's unit: a title bar, then content edge to edge.
 *
 * Panels are meant to sit in a <PanelGrid>, which draws the 1px rules between
 * them, so a panel has no border of its own there. Standalone, pass `bordered`.
 * ---------------------------------------------------------------------- */
export function Panel({
  title, meta, actions, children, className = '', bodyClassName = '', bordered = false,
}: {
  title: React.ReactNode;
  /** One fact about the panel's contents, right-aligned in the title bar. */
  meta?: React.ReactNode;
  /** Small controls, after the meta. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  bordered?: boolean;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cx('bg-surface flex flex-col min-w-0', bordered && 'border border-line', className)}
    >
      <div className="h-bar shrink-0 flex items-center gap-2.5 px-2.5 bg-surface-sunk border-b border-line whitespace-nowrap overflow-hidden">
        <h2 id={id} className="text-micro uppercase font-semibold text-ink">{title}</h2>
        {meta && <span className="ml-auto text-micro uppercase text-ink-muted truncate">{meta}</span>}
        {actions && <span className={cx('flex items-center gap-1 shrink-0', !meta && 'ml-auto')}>{actions}</span>}
      </div>
      <div className={cx('flex-1 min-w-0', bodyClassName)}>{children}</div>
    </section>
  );
}

/* Panels on a 1px grid. The gap shows the line colour through, so every
   panel edge is exactly one hairline whatever the layout. */
export function PanelGrid({
  children, className = '',
}: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('grid grid-cols-12 gap-px bg-line border border-line', className)}>
      {children}
    </div>
  );
}

/* A label and its figure on one 24px line, with an optional third column for
   the change or context. The terminal's basic way of saying a number. */
export function KeyValue({
  label, children, delta, deltaClassName = 'text-ink-muted', strong = false, title,
}: {
  label: React.ReactNode;
  children?: React.ReactNode;
  delta?: React.ReactNode;
  deltaClassName?: string;
  strong?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-2 h-row px-2.5 border-b border-line last:border-b-0" title={title}>
      <span className="flex-1 min-w-0 truncate text-caption uppercase tracking-[0.03em] text-ink-secondary">{label}</span>
      <span className={cx('text-sm text-right whitespace-nowrap', strong ? 'font-semibold text-ink' : 'text-ink')}>{children}</span>
      {delta !== undefined && (
        <span className={cx('w-24 text-right text-caption whitespace-nowrap', deltaClassName)}>{delta}</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Button — four intents, one shape. Compact and uppercase, like a function key.
 * ---------------------------------------------------------------------- */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-ink-inverse hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink border border-transparent',
  danger: 'bg-transparent text-negative border border-transparent hover:bg-negative-tint',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2 text-micro gap-1.5',
  md: 'h-7 px-2.5 text-caption gap-1.5',
  lg: 'h-8 px-3 text-sm gap-2',
};

export function Button({
  children, variant = 'secondary', size = 'md', icon: Icon, className = '', ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
}) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center rounded-control font-medium uppercase tracking-[0.05em]',
        'transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className,
      )}
      {...rest}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* Icon-only button. Always takes a label — these were unlabelled before. */
export function IconButton({
  icon: Icon, label, variant = 'ghost', className = '', ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  /** Required — an icon alone tells a screen reader nothing. */
  label: string;
  variant?: ButtonVariant;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center w-6 h-6 rounded-control transition-colors',
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
}: {
  value: number | null | undefined;
  /** Overrides the app-wide display currency; almost nothing should. */
  currency?: string;
  locale?: string;
  /** Show a leading + on positives. */
  signed?: boolean;
  /** Only when the sign carries meaning — a total isn't green just for existing. */
  colour?: boolean;
  size?: MoneySize;
  className?: string;
  decimals?: number;
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
  const sizes: Record<MoneySize, string> = {
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
 * support it.
 * ---------------------------------------------------------------------- */
export function Stat({
  label, children, hint, prominent = false, className = '',
}: {
  label: React.ReactNode;
  children?: React.ReactNode;
  hint?: React.ReactNode;
  /** The page's one dominant figure sizes itself; the rest are uniform. */
  prominent?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="label-micro">{label}</p>
      <div className={cx('mt-1', prominent ? '' : 'text-lg font-medium text-ink')}>{children}</div>
      {hint && <p className="text-caption text-ink-muted mt-0.5">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Badge — status, not decoration. An outlined tag in the status colour.
 * ---------------------------------------------------------------------- */
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'text-ink-secondary border-line-strong',
  positive: 'text-positive border-current',
  negative: 'text-negative border-current',
  caution: 'text-caution border-current',
  accent: 'text-accent-ink border-current',
};

export function Badge({
  children, tone = 'neutral', className = '',
}: { children?: React.ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cx(
      'inline-flex items-center px-1 py-px border bg-transparent whitespace-nowrap',
      'text-[10px] leading-[14px] font-medium uppercase tracking-[0.06em]',
      BADGE_TONES[tone], className,
    )}>
      {children}
    </span>
  );
}

/* A category marker: a small square of the category's colour, not a pill. */
export function CategoryMark({
  color, name, className = '',
}: { color: string; name: React.ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 min-w-0', className)}>
      <span className="w-[7px] h-[7px] shrink-0" style={{ background: color }} aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Table — ruled rows rather than a card per record, so more ledger fits on
 * screen. Numeric columns right-align; headers are quiet.
 * ---------------------------------------------------------------------- */
export function Table({
  children, className = '',
}: { children?: React.ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx('w-full text-sm', className)}>{children}</table>
    </div>
  );
}

export function Th({
  children, numeric = false, className = '', ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cx(
        'label-micro font-medium h-[22px] py-0 px-2.5 border-b border-line bg-surface-sunk whitespace-nowrap',
        numeric ? 'text-right' : 'text-left', className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children, numeric = false, className = '', ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cx('py-0 px-2.5 h-row border-b border-line align-middle',
        numeric ? 'text-right whitespace-nowrap' : 'text-left', className)}
      {...rest}
    >
      {children}
    </td>
  );
}

export function Tr({
  children, className = '', ...rest
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cx('hover:bg-surface-hover', className)} {...rest}>{children}</tr>;
}

/* -------------------------------------------------------------------------
 * Meter — progress as a square rule. `marker` draws a tick at a percentage,
 * typically how far through the month we are, so "57% spent" can be read
 * against "19% of the month gone" without arithmetic.
 * ---------------------------------------------------------------------- */
export function Meter({
  value, max, tone = 'accent', marker, className = '',
}: {
  value: number;
  max: number;
  tone?: BadgeTone;
  /** 0–100: where to draw the reference tick. */
  marker?: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;
  // Spelled out in full: Tailwind only generates classes it can see whole.
  const fills: Record<BadgeTone, string> = {
    accent: 'bg-accent', neutral: 'bg-ink-muted', positive: 'bg-positive', negative: 'bg-negative', caution: 'bg-caution',
  };
  const fill = over ? 'bg-negative' : fills[tone];
  return (
    <div className={cx('relative h-1.5 bg-line', className)} role="presentation">
      <div className={cx('h-full transition-[width] duration-300', fill)} style={{ width: `${pct}%` }} />
      {marker !== undefined && (
        <span className="absolute -top-[3px] -bottom-[3px] w-px bg-ink-secondary" style={{ left: `${Math.min(100, Math.max(0, marker))}%` }} />
      )}
    </div>
  );
}

/* A page's opening block: the figure it is about, then its supporting cast. */
export function PageLede({
  label, children, supporting, className = '',
}: {
  label: React.ReactNode;
  /** The page's dominant figure. */
  children?: React.ReactNode;
  supporting?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-4', className)}>
      <div>
        <p className="label-micro">{label}</p>
        <div className="mt-1.5">{children}</div>
      </div>
      {supporting && (
        <div className="flex flex-wrap items-end gap-6">{supporting}</div>
      )}
    </div>
  );
}
