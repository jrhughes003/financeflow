import React, { useId, useState } from 'react';
import { Plus, Edit2, Trash2, DollarSign } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as chart from './ui/chartTheme';
import { format, parseISO } from 'date-fns';
import { useFinancial } from '../context/FinancialContext';
import { Panel, PanelGrid, Button, IconButton, Money, Table, Th, Td, Tr } from './ui';
import EmptyState from './EmptyState';
import { useUndoableDelete } from '../hooks/useUndoableDelete';
import { getTotalIncome, getTotalExpenses, toMonthlyAmount, formatCurrency } from '../utils/calculations';
import { getIncomeSources } from '../utils/accounts';
import type { Income, IncomeFrequency } from '../types/domain';

const FREQUENCIES: IncomeFrequency[] = ['weekly', 'biweekly', 'semi-monthly', 'monthly', 'annual', 'once'];
const FREQ_LABELS: Record<IncomeFrequency, string> = {
  weekly: 'Weekly', biweekly: 'Biweekly', 'semi-monthly': 'Semi-monthly',
  monthly: 'Monthly', annual: 'Annual', once: 'One-time',
};

/** The edit form. Mirrors Income, but `amount` is the raw input string and the
 *  spread in openEdit carries the id of the record being edited. */
interface IncomeForm {
  id?: string;
  name?: string;
  amount: string;
  frequency: IncomeFrequency;
  /** Only meaningful when frequency is 'once'. */
  date: string;
  source?: string;
  color?: string;
}

const EMPTY_FORM: IncomeForm = { name: '', amount: '', frequency: 'monthly', date: '', source: 'employer', color: 'var(--c-data-1)' };
const COLORS = ['var(--c-data-1)','var(--c-positive)','var(--c-caution)','var(--c-data-7)','var(--c-data-5)','var(--c-data-2)'];

const INPUT = 'w-full h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';

export default function IncomeManager() {
  const { state, dispatch } = useFinancial();
  const removeItem = useUndoableDelete();
  const { incomes, transactions } = state;
  const now = new Date();
  const fid = useId();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);

  // Scheduled withdrawals from tracked accounts count as income (set on the Investments page).
  const accountIncomes = getIncomeSources([], state.investments);
  const totalMonthly = getTotalIncome([...incomes, ...accountIncomes]);
  const totalExpenses = getTotalExpenses(transactions, now.getMonth(), now.getFullYear());
  const netAvailable = totalMonthly - totalExpenses;

  const openEdit = (inc: Income) => {
    setForm({ ...inc, amount: String(inc.amount), date: inc.date || '' });
    setEditId(inc.id);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.name || !form.amount) return;
    const payload: Income = {
      id: editId || `i_${Date.now()}`,
      name: form.name,
      amount: parseFloat(form.amount),
      frequency: form.frequency,
      // Only stored for a one-off; a recurring income has no single date,
      // and keeping a stale one would be a trap for anything that reads it.
      ...(form.frequency === 'once' ? { date: form.date } : {}),
      source: form.source,
      color: form.color,
    };
    dispatch({ type: editId ? 'UPDATE_INCOME' : 'ADD_INCOME', payload });
    setForm(EMPTY_FORM);
    setShowForm(false);
    setEditId(null);
  };

  const chartData = [
    { name: 'Income', amount: Math.round(totalMonthly) },
    { name: 'Expenses', amount: Math.round(totalExpenses) },
    { name: 'Available', amount: Math.round(Math.max(0, netAvailable)) },
  ];

  const sourceCount = incomes.length + accountIncomes.length;

  return (
    <div className="space-y-2 animate-fade-in">
      <PanelGrid className="grid-flow-row-dense">
        {/* Summary */}
        <Panel
          title="Monthly income"
          meta={`${sourceCount} SOURCE${sourceCount === 1 ? '' : 'S'}`}
          className="col-span-12 md:col-span-5 xl:col-span-4"
        >
          <div className="px-2.5 py-2 border-b border-line">
            <Money value={totalMonthly} size="display" />
            <p className="text-caption text-ink-muted mt-1">
              across {sourceCount} source{sourceCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-line border-b border-line">
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Spent this month</p>
              <Money value={totalExpenses} size="lg" className="block mt-0.5" />
            </div>
            <div className="bg-surface px-2.5 py-1.5">
              <p className="label-micro">Net available</p>
              <Money value={netAvailable} size="lg" colour className="block mt-0.5" />
            </div>
          </div>
        </Panel>

        {/* Income vs Expenses chart */}
        <Panel
          title={`Income vs. Spending (${format(now, 'MMMM yyyy')})`}
          meta="MTD"
          className="col-span-12 md:col-span-7 xl:col-span-8"
          bodyClassName="p-3"
        >
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...chart.grid} />
              <XAxis dataKey="name" {...chart.xAxis} />
              <YAxis {...chart.yAxis} tickFormatter={v => chart.compactMoney(v)} />
              <Tooltip {...chart.tooltip} formatter={v => formatCurrency(chart.asNumber(v))} />
              <Bar dataKey="amount" fill={chart.SERIES.primary} name="Amount" maxBarSize={56}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={i === 0 ? 'var(--c-positive)' : i === 1 ? 'var(--c-data-2)' : 'var(--c-data-1)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Income sources list */}
        <Panel
          title="Income Sources"
          meta={sourceCount > 0 ? `${sourceCount} ACTIVE` : undefined}
          actions={(
            <Button size="sm" variant="primary" icon={Plus} onClick={() => { setShowForm(s => !s); setEditId(null); setForm(EMPTY_FORM); }}>
              Add Source
            </Button>
          )}
          className="col-span-12"
        >
          {showForm && (
            <div className="p-3 border-b border-line bg-surface-sunk space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label htmlFor={`${fid}-name`} className="label-micro block mb-1">Income Name</label>
                  <input id={`${fid}-name`} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Salary, Freelance..." className={INPUT} />
                </div>
                <div>
                  <label htmlFor={`${fid}-amount`} className="label-micro block mb-1">Amount</label>
                  <input id={`${fid}-amount`} type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="$0" className={INPUT} />
                </div>
                <div>
                  <label htmlFor={`${fid}-freq`} className="label-micro block mb-1">Frequency</label>
                  <select id={`${fid}-freq`} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as IncomeFrequency }))} className={INPUT}>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
                  </select>
                </div>
                {/* A one-off needs the date it lands on; nothing else does. */}
                {form.frequency === 'once' && (
                  <div>
                    <label htmlFor={`${fid}-date`} className="label-micro block mb-1">Date received</label>
                    <input
                      id={`${fid}-date`}
                      type="date"
                      value={form.date}
                      onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                      className={INPUT}
                    />
                  </div>
                )}
                <div>
                  <span className="label-micro block mb-1">Color</span>
                  <div className="flex gap-1 flex-wrap h-7 items-center">
                    {COLORS.map((c, i) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Colour ${i + 1}`}
                        aria-pressed={form.color === c}
                        onClick={() => setForm(f => ({ ...f, color: c }))}
                        className={`w-5 h-5 rounded-control border ${form.color === c ? 'border-ink outline outline-1 outline-accent' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button variant="primary" onClick={handleSave}>Save</Button>
                <Button variant="secondary" onClick={() => { setShowForm(false); setEditId(null); }}>Cancel</Button>
              </div>
            </div>
          )}

          {incomes.length === 0 && accountIncomes.length === 0
            ? <EmptyState
                compact
                icon={DollarSign}
                title="No income added yet"
                description="Add what you earn and how often. Everything downstream — savings rate, budgets, the long-range plan — needs it."
                actionLabel="Add income"
                onAction={() => setShowForm(true)}
              />
            : (
              <Table>
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th className="hidden sm:table-cell">Terms</Th>
                    <Th numeric>Amount</Th>
                    <Th className="w-14"><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {accountIncomes.map(inc => (
                    <Tr key={inc.id}>
                      <Td className="text-ink">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-[7px] h-[7px] shrink-0 bg-data-5" aria-hidden="true" />
                          {inc.name}
                        </span>
                      </Td>
                      <Td className="hidden sm:table-cell font-sans text-caption text-ink-muted">Monthly withdrawal · managed on the Investments page</Td>
                      <Td numeric>
                        <span className="text-ink">{formatCurrency(inc.amount)}</span><span className="text-caption text-ink-muted">/mo</span>
                      </Td>
                      <Td />
                    </Tr>
                  ))}
                  {incomes.map(inc => {
                    const monthly = toMonthlyAmount(inc.amount, inc.frequency);
                    return (
                      <Tr key={inc.id}>
                        <Td className="text-ink">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-[7px] h-[7px] shrink-0" style={{ backgroundColor: inc.color || 'var(--c-data-1)' }} aria-hidden="true" />
                            {inc.name}
                          </span>
                        </Td>
                        <Td className="hidden sm:table-cell text-caption text-ink-muted">
                          {FREQ_LABELS[inc.frequency]} · {formatCurrency(inc.amount)}
                          {inc.frequency === 'once' && inc.date && <> · {format(parseISO(inc.date), 'd MMM yyyy')}</>}
                        </Td>
                        <Td numeric>
                          {/*
                            A one-off has no monthly rate, so showing one would be
                            a lie — $2,675 arriving in November is not $2,675 a
                            month. It shows the amount and when it lands instead.
                          */}
                          {inc.frequency === 'once'
                            ? <><span className="text-ink">{formatCurrency(inc.amount)}</span><span className="text-caption text-ink-muted"> once</span></>
                            : <><span className="text-ink">{formatCurrency(monthly)}</span><span className="text-caption text-ink-muted">/mo</span></>}
                        </Td>
                        <Td>
                          <div className="flex gap-0.5 justify-end">
                            <IconButton icon={Edit2} label={`Edit ${inc.name}`} onClick={() => openEdit(inc)} />
                            <IconButton icon={Trash2} label={`Delete ${inc.name}`} variant="danger" onClick={() => removeItem({ type: 'income', item: inc })} />
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="h-row px-2.5 text-caption uppercase tracking-[0.03em] text-ink-secondary">Total Monthly Income</td>
                    <td className="hidden sm:table-cell" />
                    <td className="px-2.5 text-right text-positive">{formatCurrency(totalMonthly)}</td>
                    <td />
                  </tr>
                </tfoot>
              </Table>
            )}
        </Panel>
      </PanelGrid>
    </div>
  );
}
