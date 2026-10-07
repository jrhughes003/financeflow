import React, { useId, useMemo, useState } from 'react';
import { format, parseISO, differenceInCalendarDays, addMonths } from 'date-fns';
import { Plus, Edit2, Trash2, TrendingUp, RefreshCw, ArrowDownCircle, ArrowUpCircle, X } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import * as chart from './ui/chartTheme';
import { useFinancial } from '../context/FinancialContext';
import { Panel, PanelGrid, KeyValue, Button, IconButton, Money, Badge, CategoryMark, Table, Th, Td, Tr } from './ui';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { formatCurrency } from '../utils/calculations';
import {
  estimateAccountValue, projectAccount, syncToStatement, addAccountEntry, removeAccountEntry, isTrackedAccount,
  entryCountsAfterStatement,
} from '../utils/accounts';
import type { Investment, IsoDate } from '../types/domain';

const TYPES = ['stocks', 'bonds', 'crypto', 'retirement', 'real_estate', 'cash', 'other'];
// Keyed by Investment.type, which is a free string - an imported account can
// carry a type these maps have never heard of, so every read falls back.
const TYPE_LABELS: Record<string, string> = { stocks: 'Stocks', bonds: 'Bonds', crypto: 'Crypto', retirement: 'Retirement', real_estate: 'Real Estate', cash: 'Cash', other: 'Other' };
const TYPE_COLORS: Record<string, string> = { stocks: 'var(--c-data-1)', bonds: 'var(--c-positive)', crypto: 'var(--c-caution)', retirement: 'var(--c-data-5)', real_estate: 'var(--c-data-7)', cash: 'var(--c-data-6)', other: 'var(--c-ink-muted)' };

const todayStr = (): IsoDate => format(new Date(), 'yyyy-MM-dd');
// anchorDate and depletionDate are both optional on their results: an untracked
// account has no statement, and a sustainable one never depletes.
const fmtDate = (d: IsoDate | null | undefined): string =>
  (d ? format(parseISO(d.slice(0, 10)), 'MMM d, yyyy') : '—');
// depletedMonth is null when the balance never runs out. The caller below only
// asks in the other case, but the projection is one object, not a union.
const duration = (m: number | null): string => {
  const months = m ?? 0;
  const y = Math.floor(months / 12), r = months % 12;
  return [y && `${y} yr`, r && `${r} mo`].filter(Boolean).join(' ') || '0 mo';
};
const STALE_DAYS = 45;

/** The account form. Every number is the text in its input until it is saved. */
interface AccountForm {
  name: string;
  type: string;
  currentValue: string;
  asOfDate: IsoDate;
  costBasis: string;
  annualReturn: string;
  monthlyWithdrawal: string;
  withdrawalDay: string;
  withdrawalCountsAsIncome: boolean;
}

const EMPTY_FORM: AccountForm = {
  name: '', type: 'stocks', currentValue: '', asOfDate: todayStr(), costBasis: '', annualReturn: '7',
  monthlyWithdrawal: '', withdrawalDay: '1', withdrawalCountsAsIncome: true,
};
const inputCls = 'w-full h-7 px-2 border border-line-strong rounded-control text-sm text-ink bg-surface placeholder:text-ink-muted focus:outline-none focus:border-accent';

// Inline "amount + date" form used for statement sync and logging entries.
function AmountDateForm({ label, amountLabel, submitLabel, defaultAmount = '', onSubmit, onCancel, hint }: {
  label: React.ReactNode;
  amountLabel: string;
  submitLabel: string;
  defaultAmount?: string;
  /** The amount is the raw input text; the callers parse it. */
  onSubmit: (values: { amount: string; date: IsoDate }) => void;
  onCancel: () => void;
  hint?: React.ReactNode;
}) {
  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState(todayStr());
  const ok = parseFloat(amount) > 0;
  return (
    <div className="bg-surface-sunk border-b border-line px-2.5 py-2">
      <p className="label-micro mb-1.5">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-ink-muted">$</span>
          <input type="number" min="0" step="0.01" autoFocus value={amount} onChange={e => setAmount(e.target.value)} aria-label={amountLabel}
            onKeyDown={e => { if (e.key === 'Enter' && ok) onSubmit({ amount, date }); if (e.key === 'Escape') onCancel(); }}
            className="w-36 h-7 pl-5 pr-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
        </div>
        <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)} aria-label="Date"
          className="h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent" />
        <Button variant="primary" disabled={!ok} onClick={() => onSubmit({ amount, date })}>{submitLabel}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
      {hint && <p className="font-sans text-caption text-ink-muted mt-1.5">{hint}</p>}
    </div>
  );
}

/* One tracked account's detail: how the estimate was built, where it is
   heading, and the extra activity logged against it. */
function AccountPanel({ inv, onUpdate }: {
  inv: Investment;
  onUpdate: (inv: Investment) => void;
}) {
  const [mode, setMode] = useState<'sync' | 'withdrawal' | 'deposit' | null>(null);
  const est = estimateAccountValue(inv);
  const proj = projectAccount(inv, { months: 600 });
  const w = Number(inv.monthlyWithdrawal) || 0;
  const color = TYPE_COLORS[inv.type] || 'var(--c-ink-muted)';
  // Only tracked accounts reach this panel, so asOfDate is there; falling back
  // to today reports "not stale" rather than throwing if one ever isn't.
  const staleDays = differenceInCalendarDays(new Date(), parseISO(inv.asOfDate || todayStr()));
  const entries = [...(inv.entries || [])].sort((a, b) => b.date.localeCompare(a.date));

  // Chart: until the money runs out, or 10 years, whichever is sooner (min 2 years).
  // Named `series` because `chart` is the chartTheme import.
  const horizon = proj.depletedMonth ? Math.max(24, proj.depletedMonth) : 120;
  const series = proj.timeline.filter(p => p.month <= horizon && (p.month % 3 === 0 || p.month === proj.depletedMonth))
    .map(p => ({ ...p, label: format(addMonths(new Date(), p.month), 'MMM yyyy') }));

  return (
    <Panel
      title={<CategoryMark color={color} name={inv.name} />}
      meta={<>EST. TODAY {formatCurrency(est.value)}</>}
      className="col-span-12"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 border-b border-line text-caption text-ink-muted">
        <span>
          {TYPE_LABELS[inv.type]} · {inv.annualReturn}% expected return
          {w > 0 && <> · {formatCurrency(w)}/mo withdrawal on day {inv.withdrawalDay || 1}{inv.withdrawalCountsAsIncome !== false && ' (counted as income)'}</>}
        </span>
      </div>

      {/* How the estimate was built */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-secondary px-2.5 py-1.5 border-b border-line">
        <span>Statement {formatCurrency(est.anchorBalance)} on {fmtDate(est.anchorDate)}</span>
        <span className="text-positive">+{formatCurrency(est.growth)} est. growth</span>
        {est.scheduledWithdrawn > 0 && <span className="text-ink-secondary">−{formatCurrency(est.scheduledWithdrawn)} monthly withdrawals</span>}
        {est.extraWithdrawn > 0 && <span className="text-ink-secondary">−{formatCurrency(est.extraWithdrawn)} extra withdrawals</span>}
        {est.deposited > 0 && <span className="text-ink-secondary">+{formatCurrency(est.deposited)} deposits</span>}
      </div>
      {staleDays > STALE_DAYS && (
        <div className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line">
          <Badge tone="caution" className="shrink-0 mt-px">Stale</Badge>
          <p className="font-sans text-[12.5px] leading-snug text-ink">
            Last matched to a statement {staleDays} days ago — update it when your next statement arrives so the estimate stays accurate.
          </p>
        </div>
      )}

      {mode === 'sync' ? (
        <AmountDateForm
          label="Enter the balance from your latest statement"
          amountLabel="Statement balance" submitLabel="Update balance" defaultAmount=""
          hint="Growth and withdrawals are estimated from this date forward. Earlier logged entries stay as history."
          onSubmit={({ amount, date }) => { onUpdate(syncToStatement(inv, { balance: Number(amount), date })); setMode(null); }}
          onCancel={() => setMode(null)}
        />
      ) : mode === 'withdrawal' || mode === 'deposit' ? (
        <AmountDateForm
          label={mode === 'withdrawal' ? `Extra withdrawal (on top of the ${formatCurrency(w)} monthly one)` : 'Extra deposit'}
          amountLabel={mode === 'withdrawal' ? 'Withdrawal amount' : 'Deposit amount'}
          submitLabel={mode === 'withdrawal' ? 'Log withdrawal' : 'Log deposit'}
          hint={mode === 'withdrawal' ? 'Lowers the balance. Only the regular monthly withdrawal counts as income.' : null}
          onSubmit={({ amount, date }) => { onUpdate(addAccountEntry(inv, { type: mode, amount: Number(amount), date })); setMode(null); }}
          onCancel={() => setMode(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-1.5 px-2.5 py-1.5 border-b border-line">
          <Button size="sm" variant="primary" icon={RefreshCw} onClick={() => setMode('sync')}>Update from statement</Button>
          <Button size="sm" icon={ArrowDownCircle} onClick={() => setMode('withdrawal')}>Log extra withdrawal</Button>
          <Button size="sm" icon={ArrowUpCircle} onClick={() => setMode('deposit')}>Log deposit</Button>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-px bg-line">
        {/* Runway */}
        <div className="lg:col-span-3 bg-surface">
          <p className="label-micro px-2.5 pt-1.5">Where this is heading</p>
          <p className="font-sans text-caption text-ink-secondary px-2.5 mt-1">
            {w <= 0
              ? `With no withdrawals, it grows to about ${formatCurrency(proj.balanceAt(120))} in 10 years at ${inv.annualReturn}%.`
              : proj.sustainable
                ? <>Your {formatCurrency(w)}/mo withdrawal is within the expected growth (about {formatCurrency(proj.sustainableMonthly)}/mo), so the balance should hold or keep growing.</>
                : <>At {formatCurrency(w)}/mo and {inv.annualReturn}% growth, this lasts about <span className="font-semibold">{duration(proj.depletedMonth)}</span> — until {fmtDate(proj.depletionDate)}. Growth alone supports about {formatCurrency(proj.sustainableMonthly)}/mo indefinitely.</>}
          </p>
          <div className="p-2">
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={series} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="label" {...chart.xAxis} interval="preserveStartEnd" minTickGap={40} />
                <YAxis {...chart.yAxis} tickFormatter={v => chart.compactMoney(v)} />
                <Tooltip {...chart.tooltip} formatter={v => [formatCurrency(chart.asNumber(v)), 'Projected balance']} />
                <Line dataKey="balance" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Activity */}
        <div className="lg:col-span-2 bg-surface">
          <p className="label-micro px-2.5 h-[22px] leading-[22px] border-b border-line bg-surface-sunk">Extra activity</p>
          {entries.length === 0 ? (
            <p className="font-sans text-caption text-ink-muted p-2.5">No extra withdrawals or deposits logged.</p>
          ) : (
            <div className="max-h-44 overflow-y-auto">
              {entries.map(e => {
                const counted = entryCountsAfterStatement(inv, e);
                return (
                  <div key={e.id} className="flex items-center justify-between gap-2 h-row px-2.5 text-caption border-b border-line">
                    <span className={counted ? 'text-ink-secondary' : 'text-ink-muted'}>
                      {e.type === 'deposit' ? 'Deposit' : 'Withdrawal'} · {fmtDate(e.date)}
                      {!counted && ' (in statement)'}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className={e.type === 'deposit' ? 'text-positive font-medium' : 'text-ink font-medium'}>
                        {e.type === 'deposit' ? '+' : '−'}{formatCurrency(e.amount)}
                      </span>
                      <IconButton icon={X} label="Remove" variant="danger" className="w-5 h-5" onClick={() => onUpdate(removeAccountEntry(inv, e.id))} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

export default function InvestmentTracker() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { investments } = state;
  const fid = useId();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [projYears, setProjYears] = useState(10);

  const estimates = useMemo(() => investments.map(inv => ({ inv, est: estimateAccountValue(inv) })), [investments]);
  const totalValue = estimates.reduce((s, x) => s + x.est.value, 0);
  const totalGrowth = estimates.reduce((s, x) => s + x.est.growth, 0);
  const totalMonthlyWithdrawal = investments.reduce((s, inv) => s + (Number(inv.monthlyWithdrawal) || 0), 0);
  const projectedTotal = useMemo(
    () => investments.reduce((s, inv) => s + projectAccount(inv, { months: projYears * 12 }).balanceAt(projYears * 12), 0),
    [investments, projYears],
  );
  // Gain/loss is only meaningful where a cost basis was entered.
  const withBasis = estimates.filter(x => Number(x.inv.costBasis) > 0);
  const totalBasis = withBasis.reduce((s, x) => s + Number(x.inv.costBasis), 0);
  const totalGain = withBasis.reduce((s, x) => s + (x.est.value - Number(x.inv.costBasis)), 0);

  const byType: Record<string, number> = {};
  estimates.forEach(({ inv, est }) => { byType[inv.type] = (byType[inv.type] || 0) + est.value; });
  const pieData = Object.entries(byType).map(([type, value]) => ({
    name: TYPE_LABELS[type] || type, value: Math.round(value), color: TYPE_COLORS[type] || 'var(--c-ink-muted)', type,
  }));

  const update = (inv: Investment) => dispatch({ type: 'UPDATE_INVESTMENT', payload: inv });
  const remove = (inv: Investment) => removeItem({ type: 'investment', item: inv });

  const openEdit = (inv: Investment) => {
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
      color: TYPE_COLORS[form.type] || 'var(--c-ink-muted)',
    };
    dispatch({ type: editId ? 'UPDATE_INVESTMENT' : 'ADD_INVESTMENT', payload });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditId(null);
  };

  const gainTone = (v: number) => (v > 0 ? 'text-positive' : v < 0 ? 'text-negative' : 'text-ink-muted');

  return (
    <div className="space-y-2 animate-fade-in">
      <PanelGrid className="grid-flow-row-dense">
        {/* Summary */}
        <Panel title="Portfolio value, estimated today" meta={`${investments.length} ACCT`} className="col-span-12 md:col-span-6 xl:col-span-4">
          <div className="px-2.5 py-2 border-b border-line">
            <Money value={totalValue} size="display" />
          </div>
          <KeyValue label="Growth since statements">
            <Money value={totalGrowth} size="sm" signed colour />
          </KeyValue>
          {withBasis.length > 0 && (
            <KeyValue
              label="Gain / loss vs cost"
              delta={totalBasis > 0 ? `${totalGain >= 0 ? '+' : '−'}${Math.abs((totalGain / totalBasis) * 100).toFixed(1)}%` : undefined}
              deltaClassName={gainTone(totalGain)}
            >
              <Money value={totalGain} size="sm" signed colour />
            </KeyValue>
          )}
          <KeyValue label="Monthly withdrawals"><Money value={totalMonthlyWithdrawal} size="sm" /></KeyValue>
          <KeyValue label={`Projected in ${projYears} years`}><Money value={projectedTotal} size="sm" /></KeyValue>
        </Panel>

        {/* Allocation */}
        <Panel title="Allocation" meta={pieData.length ? `${pieData.length} TYPE${pieData.length === 1 ? '' : 'S'}` : undefined} className="col-span-12 md:col-span-6 xl:col-span-4">
          {pieData.length === 0
            ? <p className="font-sans text-sm text-ink-muted p-3">No accounts tracked.</p>
            : (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={42} outerRadius={66} dataKey="value" paddingAngle={0} stroke={pieData.length > 1 ? 'var(--c-surface)' : 'none'} isAnimationActive={false}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip {...chart.tooltip} formatter={v => formatCurrency(chart.asNumber(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="border-t border-line">
                  {pieData.map(p => (
                    <KeyValue
                      key={p.type}
                      label={<CategoryMark color={p.color} name={p.name} />}
                      delta={`${totalValue > 0 ? ((p.value / totalValue) * 100).toFixed(1) : 0}%`}
                    >
                      <Money value={p.value} size="sm" decimals={0} />
                    </KeyValue>
                  ))}
                </div>
              </>
            )}
        </Panel>

        {/* Projection */}
        <Panel title="Long-Term Projection" meta={`${projYears}Y`} className="col-span-12 xl:col-span-4">
          <div className="px-2.5 py-2 border-b border-line">
            <label htmlFor={`${fid}-years`} className="label-micro block mb-1">Years to project: <strong className="text-ink">{projYears}</strong></label>
            <input id={`${fid}-years`} type="range" min="1" max="40" value={projYears} onChange={e => setProjYears(Number(e.target.value))} className="w-full accent-[var(--c-accent)]" />
          </div>
          <KeyValue label="Estimated today"><Money value={totalValue} size="sm" /></KeyValue>
          <KeyValue label={`In ${projYears} years`} strong><Money value={projectedTotal} size="sm" /></KeyValue>
          <KeyValue label="Change">
            <span className={projectedTotal >= totalValue ? 'text-positive' : 'text-ink'}>
              {projectedTotal >= totalValue ? '+' : '−'}{formatCurrency(Math.abs(projectedTotal - totalValue))}
            </span>
          </KeyValue>
          {totalMonthlyWithdrawal > 0 && (
            <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5">Includes your {formatCurrency(totalMonthlyWithdrawal)}/mo of withdrawals continuing at the current amount.</p>
          )}
        </Panel>

        {/* Holdings — a positions blotter */}
        <Panel
          title="Accounts & Holdings"
          meta={investments.length ? `${investments.length} POSITION${investments.length === 1 ? '' : 'S'}` : undefined}
          actions={(
            <Button size="sm" variant="primary" icon={Plus} onClick={() => { setShowForm(s => !s); setEditId(null); setForm({ ...EMPTY_FORM, asOfDate: todayStr() }); }}>
              Add Account
            </Button>
          )}
          className="col-span-12"
        >
          <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5 border-b border-line">
            For accounts you can't link (like one with a financial advisor): enter the balance from a statement, and the value is estimated from there
            — growing at the expected return, minus your monthly withdrawal and any extra activity you log.
          </p>

          {showForm && (
            <div className="bg-surface-sunk border-b border-line p-3 space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label htmlFor={`${fid}-name`} className="label-micro block mb-1">Account name</label>
                  <input id={`${fid}-name`} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Advisor portfolio" className={inputCls} />
                </div>
                <div>
                  <label htmlFor={`${fid}-type`} className="label-micro block mb-1">Type</label>
                  <select id={`${fid}-type`} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>
                    {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${fid}-ret`} className="label-micro block mb-1">Expected annual return %</label>
                  <input id={`${fid}-ret`} type="number" step="0.1" value={form.annualReturn} onChange={e => setForm(f => ({ ...f, annualReturn: e.target.value }))} placeholder="7" className={inputCls} />
                </div>
                <div>
                  <label htmlFor={`${fid}-bal`} className="label-micro block mb-1">Balance</label>
                  <input id={`${fid}-bal`} type="number" value={form.currentValue} onChange={e => setForm(f => ({ ...f, currentValue: e.target.value }))} placeholder="$0" className={inputCls} />
                </div>
                <div>
                  <label htmlFor={`${fid}-asof`} className="label-micro block mb-1">Balance as of (statement date)</label>
                  <input id={`${fid}-asof`} type="date" max={todayStr()} value={form.asOfDate} onChange={e => setForm(f => ({ ...f, asOfDate: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label htmlFor={`${fid}-wd`} className="label-micro block mb-1">Monthly withdrawal (optional)</label>
                  <input id={`${fid}-wd`} type="number" value={form.monthlyWithdrawal} onChange={e => setForm(f => ({ ...f, monthlyWithdrawal: e.target.value }))} placeholder="$0" className={inputCls} />
                </div>
                <div>
                  <label htmlFor={`${fid}-wdday`} className="label-micro block mb-1">Withdrawn on day of month</label>
                  <input id={`${fid}-wdday`} type="number" min="1" max="28" value={form.withdrawalDay} onChange={e => setForm(f => ({ ...f, withdrawalDay: e.target.value }))} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label htmlFor={`${fid}-basis`} className="label-micro block mb-1">Cost basis (optional)</label>
                  <input id={`${fid}-basis`} type="number" value={form.costBasis} onChange={e => setForm(f => ({ ...f, costBasis: e.target.value }))} placeholder="$0" className={inputCls} />
                </div>
                {parseFloat(form.monthlyWithdrawal) > 0 && (
                  <label className="col-span-2 md:col-span-4 flex items-center gap-2 text-sm text-ink-secondary cursor-pointer select-none">
                    <input type="checkbox" checked={form.withdrawalCountsAsIncome} onChange={e => setForm(f => ({ ...f, withdrawalCountsAsIncome: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded-control border-line-strong accent-[var(--c-accent)]" />
                    Count the monthly withdrawal as income (it's what I live on)
                  </label>
                )}
              </div>
              <div className="flex gap-1.5">
                <Button variant="primary" onClick={handleSave}>Save</Button>
                <Button variant="secondary" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
              </div>
            </div>
          )}

          {investments.length === 0
            ? <EmptyState
                compact
                icon={TrendingUp}
                title="No accounts yet"
                description="Add an investment or advisor account to track allocation and growth, and to feed the Plan Ahead projection."
                actionLabel="Add an account"
                onAction={() => setShowForm(true)}
              />
            : (
              <Table>
                <thead>
                  <tr>
                    <Th>Account</Th>
                    <Th className="hidden md:table-cell">Type</Th>
                    <Th numeric>Value</Th>
                    <Th numeric className="hidden sm:table-cell">Cost basis</Th>
                    <Th numeric>Gain / loss</Th>
                    <Th numeric className="hidden sm:table-cell">G/L %</Th>
                    <Th numeric className="hidden lg:table-cell">Exp. ret</Th>
                    <Th numeric className="hidden lg:table-cell">W/D /mo</Th>
                    <Th className="hidden md:table-cell">As of</Th>
                    <Th className="w-14"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {estimates.map(({ inv, est }) => {
                    const tracked = isTrackedAccount(inv);
                    const basis = Number(inv.costBasis) || 0;
                    const gain = est.value - basis;
                    const w = Number(inv.monthlyWithdrawal) || 0;
                    return (
                      <Tr key={inv.id}>
                        <Td className="text-ink max-w-0 w-full truncate">
                          <CategoryMark color={TYPE_COLORS[inv.type] || 'var(--c-ink-muted)'} name={inv.name} />
                        </Td>
                        <Td className="hidden md:table-cell text-ink-secondary whitespace-nowrap">{TYPE_LABELS[inv.type] || inv.type}</Td>
                        <Td numeric><Money value={est.value} size="sm" /></Td>
                        <Td numeric className="hidden sm:table-cell">
                          {basis > 0 ? <Money value={basis} size="sm" className="text-ink-muted" /> : <span className="text-ink-muted">—</span>}
                        </Td>
                        <Td numeric>
                          {basis > 0 ? <Money value={gain} size="sm" signed colour /> : <span className="text-ink-muted">—</span>}
                        </Td>
                        <Td numeric className={`hidden sm:table-cell ${basis > 0 ? gainTone(gain) : 'text-ink-muted'}`}>
                          {basis > 0 ? `${gain >= 0 ? '+' : '−'}${Math.abs((gain / basis) * 100).toFixed(1)}%` : '—'}
                        </Td>
                        <Td numeric className="hidden lg:table-cell text-ink-secondary">{tracked ? `${inv.annualReturn}%` : '—'}</Td>
                        <Td numeric className="hidden lg:table-cell">
                          {w > 0 ? <Money value={w} size="sm" /> : <span className="text-ink-muted">—</span>}
                        </Td>
                        <Td className="hidden md:table-cell whitespace-nowrap text-ink-muted">
                          {tracked ? fmtDate(inv.asOfDate) : <span title="Fixed value — edit and add a statement date to track growth">FIXED</span>}
                        </Td>
                        <Td>
                          <div className="flex gap-0.5 justify-end">
                            <IconButton icon={Edit2} label={`Edit ${inv.name}`} onClick={() => openEdit(inv)} />
                            <IconButton icon={Trash2} label={`Delete ${inv.name}`} variant="danger" onClick={() => remove(inv)} />
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="h-row px-2.5">TOTAL</td>
                    <td className="hidden md:table-cell" />
                    <td className="px-2.5 text-right"><Money value={totalValue} size="sm" /></td>
                    <td className="hidden sm:table-cell px-2.5 text-right">{totalBasis > 0 ? <Money value={totalBasis} size="sm" className="text-ink-muted" /> : ''}</td>
                    <td className="px-2.5 text-right">{withBasis.length > 0 ? <Money value={totalGain} size="sm" signed colour /> : ''}</td>
                    <td className={`hidden sm:table-cell px-2.5 text-right ${gainTone(totalGain)}`}>
                      {totalBasis > 0 ? `${totalGain >= 0 ? '+' : '−'}${Math.abs((totalGain / totalBasis) * 100).toFixed(1)}%` : ''}
                    </td>
                    <td className="hidden lg:table-cell" />
                    <td className="hidden lg:table-cell px-2.5 text-right">{totalMonthlyWithdrawal > 0 ? <Money value={totalMonthlyWithdrawal} size="sm" /> : ''}</td>
                    <td className="hidden md:table-cell" />
                    <td />
                  </tr>
                </tfoot>
              </Table>
            )}
          {investments.some(inv => !isTrackedAccount(inv)) && (
            <p className="font-sans text-caption text-ink-muted px-2.5 py-1.5">
              FIXED: fixed value — edit and add a statement date to track growth.
            </p>
          )}
        </Panel>

        {/* One detail panel per tracked account */}
        {investments.filter(isTrackedAccount).map(inv => (
          <AccountPanel key={inv.id} inv={inv} onUpdate={update} />
        ))}
      </PanelGrid>
    </div>
  );
}
