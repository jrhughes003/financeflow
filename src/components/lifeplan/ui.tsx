import React, { useId } from 'react';

// Small shared form pieces for the Plan Ahead screens.

export const inputCls = 'w-full px-3 py-2 border border-line-strong rounded-control text-sm bg-surface focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent';

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
      <label htmlFor={labelsOneControl ? id : undefined} className="label-micro block mb-1.5">
        {label}
      </label>
      {labelsOneControl ? children(id) : children}
      {hint && <p className="text-micro text-ink-muted mt-1">{hint}</p>}
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
            className={`${inputCls} ${suffix ? 'pr-8' : ''}`}
          />
          {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-caption text-ink-muted">{suffix}</span>}
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
        className="mt-0.5 w-4 h-4 rounded-[3px] border-line-strong text-accent focus:ring-accent focus-visible:ring-2 focus-visible:ring-accent" />
      <span>
        <span className="text-sm text-ink-secondary">{label}</span>
        {hint && <span className="block text-micro text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Card({
  title, subtitle, actions, children,
}: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-surface rounded-container border border-line p-5">
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="text-caption text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

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
    <div className="bg-surface-sunk rounded-container p-3">
      <p className="text-caption text-ink-muted">{label}</p>
      <p className={`text-lg font-bold ${accent || 'text-ink'}`}>{value}</p>
      {sub && <p className="text-caption text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}
