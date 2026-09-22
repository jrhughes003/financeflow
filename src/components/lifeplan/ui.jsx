import React from 'react';

// Small shared form pieces for the Plan Ahead screens.

export const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-blue-500';

export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function NumberField({ label, value, onChange, suffix, hint, min, step = '1', placeholder, className }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <div className="relative">
        <input
          type="number" min={min} step={step} placeholder={placeholder}
          value={value ?? ''} onChange={e => onChange(e.target.value)}
          className={`${inputCls} ${suffix ? 'pr-8' : ''}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{suffix}</span>}
      </div>
    </Field>
  );
}

export function MonthField({ label, value, onChange, hint, className }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input type="month" value={value || ''} onChange={e => onChange(e.target.value)} className={inputCls} />
    </Field>
  );
}

export function TextField({ label, value, onChange, placeholder, hint, className }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, hint, className }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 rounded border-gray-300 text-blue-600" />
      <span>
        <span className="text-sm text-gray-700">{label}</span>
        {hint && <span className="block text-[11px] text-gray-400">{hint}</span>}
      </span>
    </label>
  );
}

export function Card({ title, subtitle, actions, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, accent }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${accent || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
