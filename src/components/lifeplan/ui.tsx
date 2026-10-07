import React, { useId } from 'react';

// Small shared form pieces for the Plan Ahead screens, in the terminal idiom:
// square 28px controls, micro labels, panels with a title bar.

export const inputCls = 'w-full h-7 px-2 border border-line-strong rounded-control text-sm text-ink bg-surface placeholder:text-ink-muted focus:outline-none focus:border-accent';

interface FieldShell {
  label: string;
  hint?: string;
  className?: string;
}

/**
 * Label, control, hint.
 *
 * Pass a function and it hands you a generated id to put on the control, and
 * ties the label to it. Visual adjacency is not association: without that a
 * screen reader announces the input as unlabelled and clicking the label
 * focuses nothing.
 *
 * Plain children are also allowed, for the cases that group several controls
 * under one heading — there the label gets no `htmlFor`, because pointing it
 * at nothing would be worse than leaving it off.
 */
export function Field({
  label, hint, children, className = '',
}: FieldShell & { children?: React.ReactNode | ((id: string) => React.ReactNode) }) {
  const id = useId();
  const labelsOneControl = typeof children === 'function';
  return (
    <div className={className}>
      <label htmlFor={labelsOneControl ? id : undefined} className="label-micro block mb-1">
        {label}
      </label>
      {labelsOneControl ? children(id) : children}
      {hint && <p className="font-sans text-caption text-ink-muted mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

export function NumberField({
  label, value, onChange, suffix, hint, min, step = '1', placeholder, className,
}: FieldShell & {
  value: number | string | null | undefined;
  onChange: (value: string) => void;
  suffix?: string;
  min?: number | string;
  step?: number | string;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {id => (
        <div className="relative">
          <input
            id={id}
            type="number" min={min} step={step} placeholder={placeholder}
            value={value ?? ''} onChange={e => onChange(e.target.value)}
            className={`${inputCls} ${suffix ? 'pr-14' : ''}`}
          />
          {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-caption text-ink-muted pointer-events-none">{suffix}</span>}
        </div>
      )}
    </Field>
  );
}

export function MonthField({
  label, value, onChange, hint, className,
}: FieldShell & { value: string | null | undefined; onChange: (value: string) => void }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {id => (
        <input id={id} type="month" value={value || ''} onChange={e => onChange(e.target.value)} className={inputCls} />
      )}
    </Field>
  );
}

export function TextField({
  label, value, onChange, placeholder, hint, className,
}: FieldShell & {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {id => (
        <input id={id} type="text" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
      )}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  label, value, onChange, options, hint, className,
}: FieldShell & {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {id => (
        <select id={id} value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/** Wrapping label — the control is inside it, so it needs no id. */
export function Toggle({
  label, checked, onChange, hint,
}: {
  label: string;
  checked: boolean | undefined;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)}
        className="mt-[3px] w-3.5 h-3.5 shrink-0 rounded-control border-line-strong accent-[var(--c-accent)]" />
      <span>
        <span className="text-sm text-ink-secondary">{label}</span>
        {hint && <span className="block font-sans text-caption text-ink-muted leading-snug">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * A terminal panel: a title bar (title, one fact, actions), an optional
 * sentence of explanation under it, then the body.
 *
 * Not ui's <Panel> because these title bars carry real controls (toggles,
 * search buttons) that must wrap on a narrow screen rather than be clipped.
 * Bordered by default; pass `bordered={false}` inside a <PanelGrid>.
 */
export function Card({
  title, subtitle, meta, actions, children, flush = false, bordered = true, className = '',
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Body edge to edge — for tables and row lists. Otherwise padded. */
  flush?: boolean;
  bordered?: boolean;
  className?: string;
}) {
  const id = useId();
  const hasBar = title || actions || meta;
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className={`bg-surface flex flex-col min-w-0 ${bordered ? 'border border-line' : ''} ${className}`}
    >
      {hasBar && (
        <div className="min-h-bar shrink-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-0.5 bg-surface-sunk border-b border-line">
          {title && <h2 id={id} className="text-micro uppercase font-semibold text-ink">{title}</h2>}
          {meta && <span className="ml-auto text-micro uppercase text-ink-muted">{meta}</span>}
          {actions && <div className={`flex flex-wrap items-center gap-1.5 ${meta ? '' : 'ml-auto'}`}>{actions}</div>}
        </div>
      )}
      {subtitle && (
        <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">{subtitle}</p>
      )}
      <div className={`flex-1 min-w-0 ${flush ? '' : 'p-3'}`}>{children}</div>
    </section>
  );
}

/** A compact figure cell. Lay several out in `grid gap-px bg-line` so the
 *  gaps draw hairlines between them, like the Dashboard's strip. */
export function Stat({
  label, value, sub, accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** A text-colour class, when the figure's sign or status carries meaning. */
  accent?: string;
}) {
  return (
    <div className="bg-surface px-2.5 py-1.5 min-w-0">
      <p className="label-micro">{label}</p>
      <p className={`text-xl font-medium mt-0.5 ${accent || 'text-ink'}`}>{value}</p>
      {sub && <p className="text-caption text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

/** A two-or-more-way segmented switch: square, accent on the active choice. */
export function Segmented<T extends string | boolean>({
  options, value, onChange, className = '',
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex border border-line-strong rounded-control bg-surface ${className}`}>
      {options.map(([val, label]) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(val)}
          aria-pressed={value === val}
          className={`flex-1 h-[26px] px-2.5 text-caption font-medium uppercase tracking-[0.05em] whitespace-nowrap border-l border-line-strong first:border-l-0 transition-colors ${
            value === val ? 'bg-accent-tint text-accent-ink' : 'text-ink-muted hover:text-ink hover:bg-surface-hover'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** One sentence with an outlined status tag in front — the terminal callout. */
export function Note({
  tag, tone = 'neutral', children, className = '',
}: {
  tag: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'caution' | 'accent' | 'info';
  children?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: 'text-ink-secondary border-line-strong',
    positive: 'text-positive border-current',
    negative: 'text-negative border-current',
    caution: 'text-caution border-current',
    accent: 'text-accent-ink border-current',
    info: 'text-info border-current',
  };
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <span className={`shrink-0 min-w-[3rem] text-center px-1 border text-[10px] leading-[14px] font-medium uppercase tracking-[0.06em] mt-px ${tones[tone]}`}>{tag}</span>
      <div className="font-sans text-caption leading-snug text-ink min-w-0">{children}</div>
    </div>
  );
}
