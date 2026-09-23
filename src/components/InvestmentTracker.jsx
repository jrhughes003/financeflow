import React, { useMemo, useState } from 'react';
import { format, parseISO, differenceInCalendarDays, addMonths } from 'date-fns';
import { Plus, Edit2, Trash2, TrendingUp, RefreshCw, ArrowDownCircle, ArrowUpCircle, X, AlertCircle } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import * as chart from './ui/chartTheme';
import { useFinancial } from '../context/FinancialContext';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { formatCurrency } from '../utils/calculations';
import {
  estimateAccountValue, projectAccount, syncToStatement, addAccountEntry, removeAccountEntry, isTrackedAccount,
  entryCountsAfterStatement,
} from '../utils/accounts';

const TYPES = ['stocks', 'bonds', 'crypto', 'retirement', 'real_estate', 'cash', 'other'];
const TYPE_LABELS = { stocks: 'Stocks', bonds: 'Bonds', crypto: 'Crypto', retirement: 'Retirement', real_estate: 'Real Estate', cash: 'Cash', other: 'Other' };
const TYPE_COLORS = { stocks: '#3b82f6', bonds: '#22c55e', crypto: '#f59e0b', retirement: '#8b5cf6', real_estate: '#ec4899', cash: '#10b981', other: '#94a3b8' };

const todayStr = () => format(new Date(), 'yyyy-MM-dd');
const fmtDate = d => format(parseISO(d.slice(0, 10)), 'MMM d, yyyy');
const duration = m => {
  const y = Math.floor(m / 12), r = m % 12;
  return [y && `${y} yr`, r && `${r} mo`].filter(Boolean).join(' ') || '0 mo';
};
const STALE_DAYS = 45;

const EMPTY_FORM = {
  name: '', type: 'stocks', currentValue: '', asOfDate: todayStr(), costBasis: '', annualReturn: '7',
  monthlyWithdrawal: '', withdrawalDay: '1', withdrawalCountsAsIncome: true,
};
const inputCls = 'w-full px-3 py-2 border border-line-strong rounded-control text-sm bg-surface focus:outline-none focus:border-accent';

// Inline "amount + date" form used for statement sync and logging entries.
function AmountDateForm({ label, amountLabel, submitLabel, defaultAmount = '', onSubmit, onCancel, hint }) {
  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState(todayStr());
  const ok = parseFloat(amount) > 0;
  return (
    <div className="bg-surface-sunk rounded-control p-3 mt-3">
      <p className="text-caption font-medium text-ink-secondary mb-2">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-muted">$</span>
          <input type="number" min="0" step="0.01" autoFocus value={amount} onChange={e => setAmount(e.target.value)} aria-label={amountLabel}
            onKeyDown={e => { if (e.key === 'Enter' && ok) onSubmit({ amount, date }); if (e.key === 'Escape') onCancel(); }}
            className="w-36 h-9 pl-6 pr-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
        </div>
        <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)} aria-label="Date"
          className="h-9 px-2.5 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
        <button disabled={!ok} onClick={() => onSubmit({ amount, date })} className="px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-ink-inverse text-caption font-medium rounded-control">{submitLabel}</button>
        <button onClick={onCancel} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
      </div>
      {hint && <p className="text-caption text-ink-muted mt-1.5">{hint}</p>}
    </div>
  );
}

function AccountCard({ inv, onUpdate, onEdit, onDelete }) {
  const [mode, setMode] = useState(null); // 'sync' | 'withdrawal' | 'deposit'
  const est = estimateAccountValue(inv);
  const proj = projectAccount(inv, { months: 600 });
  const w = Number(inv.monthlyWithdrawal) || 0;
  const color = TYPE_COLORS[inv.type] || '#94a3b8';
  const staleDays = differenceInCalendarDays(new Date(), parseISO(inv.asOfDate));
  const entries = [...(inv.entries || [])].sort((a, b) => b.date.localeCompare(a.date));

  // Chart: until the money runs out, or 10 years, whichever is sooner (min 2 years).
  const horizon = proj.depletedMonth ? Math.max(24, proj.depletedMonth) : 120;
  const chart = proj.timeline.filter(p => p.month <= horizon && (p.month % 3 === 0 || p.month === proj.depletedMonth))
    .map(p => ({ ...p, label: format(addMonths(new Date(), p.month), 'MMM yyyy') }));

  return (
    <div className="border border-line rounded-container p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-container flex items-center justify-center shrink-0" style={{ backgroundColor: color + '20' }}>
            <TrendingUp className="w-4 h-4" style={{ color }} />
          </div>
          <div>
            <p className="font-semibold text-ink">{inv.name}</p>
            <p className="text-caption text-ink-muted">
              {TYPE_LABELS[inv.type]} · {inv.annualReturn}% expected return
              {w > 0 && <> · {formatCurrency(w)}/mo withdrawal on day {inv.withdrawalDay || 1}{inv.withdrawalCountsAsIncome !== false && ' (counted as income)'}</>}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="text-right">
            <p className="text-xl font-bold text-ink">{formatCurrency(est.value)}</p>
            <p className="text-caption text-ink-muted">estimated today</p>
          </div>
          <div className="flex gap-1">
            <button onClick={() => onEdit(inv)} title="Edit" className="p-1.5 text-ink-muted hover:text-accent hover:bg-accent-tint rounded-control"><Edit2 className="w-3.5 h-3.5" /></button>
            <button onClick={() => onDelete(inv.id)} title="Delete" className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>

      {/* How the estimate was built */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-secondary bg-surface-sunk rounded-control px-3 py-2 mt-3">
        <span>Statement {formatCurrency(est.anchorBalance)} on {fmtDate(est.anchorDate)}</span>
        <span className="text-positive">+{formatCurrency(est.growth)} est. growth</span>
        {est.scheduledWithdrawn > 0 && <span className="text-ink-secondary">−{formatCurrency(est.scheduledWithdrawn)} monthly withdrawals</span>}
        {est.extraWithdrawn > 0 && <span className="text-ink-secondary">−{formatCurrency(est.extraWithdrawn)} extra withdrawals</span>}
        {est.deposited > 0 && <span className="text-ink-secondary">+{formatCurrency(est.deposited)} deposits</span>}
      </div>
      {staleDays > STALE_DAYS && (
        <p className="flex items-center gap-1.5 text-caption text-caution mt-2">
          <AlertCircle className="w-3.5 h-3.5" />Last matched to a statement {staleDays} days ago — update it when your next statement arrives so the estimate stays accurate.
        </p>
      )}

      {mode === 'sync' ? (
        <AmountDateForm
          label="Enter the balance from your latest statement"
          amountLabel="Statement balance" submitLabel="Update balance" defaultAmount=""
          hint="Growth and withdrawals are estimated from this date forward. Earlier logged entries stay as history."
          onSubmit={({ amount, date }) => { onUpdate(syncToStatement(inv, { balance: amount, date })); setMode(null); }}
          onCancel={() => setMode(null)}
        />
      ) : mode === 'withdrawal' || mode === 'deposit' ? (
        <AmountDateForm
          label={mode === 'withdrawal' ? `Extra withdrawal (on top of the ${formatCurrency(w)} monthly one)` : 'Extra deposit'}
          amountLabel={mode === 'withdrawal' ? 'Withdrawal amount' : 'Deposit amount'}
          submitLabel={mode === 'withdrawal' ? 'Log withdrawal' : 'Log deposit'}
          hint={mode === 'withdrawal' ? 'Lowers the balance. Only the regular monthly withdrawal counts as income.' : null}
          onSubmit={({ amount, date }) => { onUpdate(addAccountEntry(inv, { type: mode, amount, date })); setMode(null); }}
          onCancel={() => setMode(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={() => setMode('sync')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover text-ink-inverse text-caption font-medium rounded-control">
            <RefreshCw className="w-3.5 h-3.5" />Update from statement
          </button>
          <button onClick={() => setMode('withdrawal')} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">
            <ArrowDownCircle className="w-3.5 h-3.5" />Log extra withdrawal
          </button>
          <button onClick={() => setMode('deposit')} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-7 px-2.5 text-caption border border-line-strong text-ink hover:bg-surface-hover">
            <ArrowUpCircle className="w-3.5 h-3.5" />Log deposit
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-4 mt-4">
        {/* Runway */}
        <div className="lg:col-span-3">
          <p className="text-sm font-semibold text-ink-secondary mb-1">Where this is heading</p>
          <p className="text-caption text-ink-secondary mb-2">
            {w <= 0
              ? `With no withdrawals, it grows to about ${formatCurrency(proj.balanceAt(120))} in 10 years at ${inv.annualReturn}%.`
              : proj.sustainable
                ? <>Your {formatCurrency(w)}/mo withdrawal is within the expected growth (about {formatCurrency(proj.sustainableMonthly)}/mo), so the balance should hold or keep growing.</>
                : <>At {formatCurrency(w)}/mo and {inv.annualReturn}% growth, this lasts about <span className="font-semibold">{duration(proj.depletedMonth)}</span> — until {fmtDate(proj.depletionDate)}. Growth alone supports about {formatCurrency(proj.sustainableMonthly)}/mo indefinitely.</>}
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chart} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="label" {...chart.xAxis} tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${Math.round(v / 1000)}k`} width={40} />
              <Tooltip formatter={v => [formatCurrency(v), 'Projected balance']} />
              <Line dataKey="balance" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Activity */}
        <div className="lg:col-span-2">
          <p className="text-sm font-semibold text-ink-secondary mb-1">Extra activity</p>
          {entries.length === 0 ? (
            <p className="text-caption text-ink-muted">No extra withdrawals or deposits logged.</p>
          ) : (
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {entries.map(e => {
                const counted = entryCountsAfterStatement(inv, e);
                return (
                  <div key={e.id} className="flex items-center justify-between text-caption py-1 border-b border-line-faint">
                    <span className={counted ? 'text-ink-secondary' : 'text-ink-muted'}>
                      {e.type === 'deposit' ? 'Deposit' : 'Withdrawal'} · {fmtDate(e.date)}
                      {!counted && ' (in statement)'}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className={e.type === 'deposit' ? 'text-positive font-medium' : 'text-ink font-medium'}>
                        {e.type === 'deposit' ? '+' : '−'}{formatCurrency(e.amount)}
                      </span>
                      <button onClick={() => onUpdate(removeAccountEntry(inv, e.id))} title="Remove" className="p-0.5 text-ink-muted hover:text-negative rounded"><X className="w-3 h-3" /></button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InvestmentTracker() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { investments } = state;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [projYears, setProjYears] = useState(10);

  const estimates = useMemo(() => investments.map(inv => ({ inv, est: estimateAccountValue(inv) })), [investments]);
  const totalValue = estimates.reduce((s, x) => s + x.est.value, 0);
  const totalGrowth = estimates.reduce((s, x) => s + x.est.growth, 0);
  const totalMonthlyWithdrawal = investments.reduce((s, inv) => s + (Number(inv.monthlyWithdrawal) || 0), 0);
  const projectedTotal = useMemo(
    () => investments.reduce((s, inv) => s + projectAccount(inv, { months: projYears * 12 }).balanceAt(projYears * 12), 0),
    [investments, projYears],
  );

  const byType = {};
  estimates.forEach(({ inv, est }) => { byType[inv.type] = (byType[inv.type] || 0) + est.value; });
  const pieData = Object.entries(byType).map(([type, value]) => ({
    name: TYPE_LABELS[type] || type, value: Math.round(value), color: TYPE_COLORS[type] || '#94a3b8', type,
  }));

  const update = inv => dispatch({ type: 'UPDATE_INVESTMENT', payload: inv });
  const remove = inv => removeItem({ type: 'investment', item: inv });

  const openEdit = inv => {
    setForm({
      ...EMPTY_FORM,
      ...inv,
      currentValue: String(inv.currentValue),
      asOfDate: inv.asOfDate || todayStr(),
      costBasis: String(inv.costBasis || ''),
      annualReturn: String(inv.annualReturn ?? 7),
      monthlyWithdrawal: inv.monthlyWithdrawal ? String(inv.monthlyWithdrawal) : '',
      withdrawalDay: String(inv.withdrawalDay || 1),
      withdrawalCountsAsIncome: inv.withdrawalCountsAsIncome !== false,
    });
    setEditId(inv.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || form.currentValue === '') return;
    const existing = investments.find(i => i.id === editId);
    const balance = parseFloat(form.currentValue) || 0;
    const asOfDate = form.asOfDate || todayStr();
    // A new balance/date is a new statement anchor (see entryCountsAfterStatement).
    const reanchored = !existing || existing.currentValue !== balance || existing.asOfDate !== asOfDate;
    const payload = {
      ...(existing || {}),
      id: editId || `inv_${Date.now()}`,
      name: form.name,
      type: form.type,
      currentValue: balance,
      asOfDate,
      syncedAt: reanchored ? Date.now() : existing.syncedAt,
      costBasis: parseFloat(form.costBasis) || 0,
      annualReturn: form.annualReturn === '' ? 7 : parseFloat(form.annualReturn) || 0,
      monthlyWithdrawal: parseFloat(form.monthlyWithdrawal) || 0,
      withdrawalDay: Math.min(28, Math.max(1, parseInt(form.withdrawalDay, 10) || 1)),
      withdrawalCountsAsIncome: !!form.withdrawalCountsAsIncome,
      entries: existing?.entries || [],
      color: TYPE_COLORS[form.type] || '#94a3b8',
    };
    dispatch({ type: editId ? 'UPDATE_INVESTMENT' : 'ADD_INVESTMENT', payload });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditId(null);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Value (est. today)', value: formatCurrency(totalValue), color: 'text-accent-ink', bg: 'bg-accent-tint' },
          { label: 'Est. growth since statements', value: `${totalGrowth >= 0 ? '+' : ''}${formatCurrency(totalGrowth)}`, color: 'text-positive', bg: 'bg-positive-tint' },
          { label: 'Monthly withdrawals', value: formatCurrency(totalMonthlyWithdrawal), color: 'text-ink', bg: 'bg-surface-sunk' },
          { label: `Projected in ${projYears} years`, value: formatCurrency(projectedTotal), color: 'text-violet-700', bg: 'bg-violet-50' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`${bg} rounded-container p-4`}>
            <p className="text-caption font-medium text-ink-muted mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Holdings */}
      <div className="bg-surface rounded-container border border-line p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-ink">Accounts & Holdings</h2>
          <button onClick={() => { setShowForm(s => !s); setEditId(null); setForm({ ...EMPTY_FORM, asOfDate: todayStr() }); }} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">
            <Plus className="w-3.5 h-3.5" /> Add Account
          </button>
        </div>
        <p className="text-caption text-ink-muted mb-4">
          For accounts you can't link (like one with a financial advisor): enter the balance from a statement, and the value is estimated from there
          — growing at the expected return, minus your monthly withdrawal and any extra activity you log.
        </p>

        {showForm && (
          <div className="bg-accent-tint rounded-container p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label-micro block mb-1.5">Account name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Advisor portfolio" className={inputCls} />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>
                  {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="label-micro block mb-1.5">Expected annual return %</label>
                <input type="number" step="0.1" value={form.annualReturn} onChange={e => setForm(f => ({ ...f, annualReturn: e.target.value }))} placeholder="7" className={inputCls} />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Balance</label>
                <input type="number" value={form.currentValue} onChange={e => setForm(f => ({ ...f, currentValue: e.target.value }))} placeholder="$0" className={inputCls} />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Balance as of (statement date)</label>
                <input type="date" max={todayStr()} value={form.asOfDate} onChange={e => setForm(f => ({ ...f, asOfDate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Monthly withdrawal (optional)</label>
                <input type="number" value={form.monthlyWithdrawal} onChange={e => setForm(f => ({ ...f, monthlyWithdrawal: e.target.value }))} placeholder="$0" className={inputCls} />
              </div>
              <div>
                <label className="label-micro block mb-1.5">Withdrawn on day of month</label>
                <input type="number" min="1" max="28" value={form.withdrawalDay} onChange={e => setForm(f => ({ ...f, withdrawalDay: e.target.value }))} className={inputCls} />
              </div>
              {parseFloat(form.monthlyWithdrawal) > 0 && (
                <label className="col-span-2 flex items-center gap-2 text-sm text-ink-secondary cursor-pointer select-none">
                  <input type="checkbox" checked={form.withdrawalCountsAsIncome} onChange={e => setForm(f => ({ ...f, withdrawalCountsAsIncome: e.target.checked }))}
                    className="w-4 h-4 rounded-[3px] border-line-strong text-accent focus:ring-accent" />
                  Count the monthly withdrawal as income (it's what I live on)
                </label>
              )}
              <div className="col-span-2">
                <label className="label-micro block mb-1.5">Cost basis (optional)</label>
                <input type="number" value={form.costBasis} onChange={e => setForm(f => ({ ...f, costBasis: e.target.value }))} placeholder="$0" className={inputCls} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm bg-accent hover:bg-accent-hover text-ink-inverse">Save</button>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {investments.length === 0
            ? <EmptyState
                compact
                icon={TrendingUp}
                title="No accounts yet"
                description="Add an investment or advisor account to track allocation and growth, and to feed the Plan Ahead projection."
                actionLabel="Add an account"
                onAction={() => setShowForm(true)}
              />
            : investments.map(inv => isTrackedAccount(inv)
              ? <AccountCard key={inv.id} inv={inv} onUpdate={update} onEdit={openEdit} onDelete={remove} />
              : (
                <div key={inv.id} className="flex items-center gap-3 p-3 rounded-container border border-line">
                  <div className="w-10 h-10 rounded-container flex items-center justify-center shrink-0" style={{ backgroundColor: (TYPE_COLORS[inv.type] || '#94a3b8') + '20' }}>
                    <TrendingUp className="w-4 h-4" style={{ color: TYPE_COLORS[inv.type] || '#94a3b8' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink text-sm">{inv.name}</p>
                    <p className="text-caption text-ink-muted">{TYPE_LABELS[inv.type]} · fixed value — edit and add a statement date to track growth</p>
                  </div>
                  <p className="font-bold text-ink text-sm">{formatCurrency(inv.currentValue)}</p>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(inv)} className="p-1.5 text-ink-muted hover:text-accent hover:bg-accent-tint rounded-control"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(inv)} aria-label={`Delete ${inv.name}`} title={`Delete ${inv.name}`} className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))
          }
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Allocation */}
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink mb-4">Allocation</h2>
          {pieData.length === 0
            ? <p className="text-sm text-ink-muted text-center py-8">No accounts tracked.</p>
            : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" paddingAngle={pieData.length > 1 ? 2 : 0} stroke={pieData.length > 1 ? '#fff' : 'none'} isAnimationActive={false}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip {...chart.tooltip} formatter={v => formatCurrency(v)} />
                  <Legend formatter={(val, entry) => `${val}: ${totalValue > 0 ? ((entry.payload.value / totalValue) * 100).toFixed(1) : 0}%`} />
                </PieChart>
              </ResponsiveContainer>
            )}
        </div>

        {/* Projection */}
        <div className="bg-surface rounded-container border border-line p-5">
          <h2 className="text-lg font-semibold text-ink mb-4">Long-Term Projection</h2>
          <div className="mb-4">
            <label className="block text-caption font-medium text-ink-muted mb-2">Years to project: <strong>{projYears}</strong></label>
            <input type="range" min="1" max="40" value={projYears} onChange={e => setProjYears(Number(e.target.value))} className="w-full accent-blue-600" />
          </div>
          <div className="bg-accent-tint rounded-container p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-ink-secondary">Estimated today</span>
              <span className="font-semibold">{formatCurrency(totalValue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-secondary">In {projYears} years</span>
              <span className="font-bold text-accent-ink text-base">{formatCurrency(projectedTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-ink-secondary">Change</span>
              <span className={`font-semibold ${projectedTotal >= totalValue ? 'text-positive' : 'text-ink'}`}>
                {projectedTotal >= totalValue ? '+' : '−'}{formatCurrency(Math.abs(projectedTotal - totalValue))}
              </span>
            </div>
            {totalMonthlyWithdrawal > 0 && (
              <p className="text-caption text-ink-muted pt-1">Includes your {formatCurrency(totalMonthlyWithdrawal)}/mo of withdrawals continuing at the current amount.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
