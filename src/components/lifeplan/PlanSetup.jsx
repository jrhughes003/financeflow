import React from 'react';
import { Plus, Trash2, Users, Briefcase, Home, Wallet, Settings2 } from 'lucide-react';
import { formatCurrency } from '../../utils/calculations';
import { estimateAccountValue } from '../../utils/accounts';
import { BUCKETS, newId } from '../../utils/lifeplan/snapshot';
import { Card, Field, NumberField, TextField, MonthField, SelectField, Toggle, inputCls } from './ui';

const PERSON_LABEL = { me: 'You', partner: 'Partner' };

export default function PlanSetup({ plan, setPlan, state, snapshot }) {
  const update = patch => setPlan({ ...plan, ...patch });
  const setPerson = (id, patch) => update({ people: plan.people.map(p => (p.id === id ? { ...p, ...patch } : p)) });
  const setLiving = patch => update({ living: { ...plan.living, ...patch } });
  const setAssumptions = patch => update({ assumptions: { ...plan.assumptions, ...patch } });
  const setIncome = (id, patch) => update({ incomes: plan.incomes.map(i => (i.id === id ? { ...i, ...patch } : i)) });
  const people = plan.people.filter(p => p.id === 'me' || p.enabled);

  const addIncome = () => update({
    incomes: [...plan.incomes, {
      id: newId('inc'), personId: 'me', name: 'Salary', start: '', end: '',
      annual: 60000, growthPct: 3, rrspPct: 0, employerMatchPct: 0,
    }],
  });

  return (
    <div className="space-y-5">
      {/* People */}
      <Card title="You & your household" subtitle="Ages drive retirement, CPP and OAS timing.">
        <div className="space-y-4">
          {plan.people.map(p => {
            const on = p.id === 'me' || p.enabled;
            return (
              <div key={p.id} className={`rounded-xl border p-4 ${on ? 'border-gray-100' : 'border-dashed border-gray-200 bg-gray-50/50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-semibold text-gray-900">{PERSON_LABEL[p.id]}</span>
                  </div>
                  {p.id === 'partner' && (
                    <Toggle label="Include a partner in the plan" checked={p.enabled} onChange={v => setPerson('partner', { enabled: v })} />
                  )}
                </div>
                {on && (
                  <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <NumberField label="Birth year" value={p.birthYear ?? ''} onChange={v => setPerson(p.id, { birthYear: v })} placeholder="1999" />
                    <NumberField label="Retire at age" value={p.retireAge} onChange={v => setPerson(p.id, { retireAge: v })} />
                    <NumberField label="CPP at 65" value={p.cppAt65} onChange={v => setPerson(p.id, { cppAt65: v })} suffix="/yr" hint="Today's dollars. Max is about $17,200; average is closer to $9,000." />
                    <NumberField label="Start CPP at" value={p.cppStartAge} onChange={v => setPerson(p.id, { cppStartAge: v })} hint="60–70" />
                    <NumberField label="TFSA room today" value={p.tfsaRoom} onChange={v => setPerson(p.id, { tfsaRoom: v })} hint="Unused contribution room" />
                    <NumberField label="RRSP room today" value={p.rrspRoom} onChange={v => setPerson(p.id, { rrspRoom: v })} />
                    <NumberField label="FHSA per year" value={p.fhsaAnnual} onChange={v => setPerson(p.id, { fhsaAnnual: v })} suffix="/yr" hint="Up to $8,000/yr, $40,000 lifetime, for a first home" className="sm:col-span-2" />
                    <NumberField label="FHSA already contributed" value={p.fhsaContributedSoFar ?? ''} onChange={v => setPerson(p.id, { fhsaContributedSoFar: v })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Income streams */}
      <Card
        title="Income"
        subtitle="Each job or income source, when it starts, and how it grows. Leave the end date blank to run it until retirement."
        actions={<button onClick={addIncome} className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium"><Plus className="w-3.5 h-3.5" />Add income</button>}
      >
        {plan.incomes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            No income yet. Add the job you expect to start — that's what makes a house or wedding affordable in the projection.
          </p>
        ) : (
          <div className="space-y-3">
            {plan.incomes.map(inc => (
              <div key={inc.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-semibold text-gray-900">{inc.name || 'Income'}</span>
                  </div>
                  <button onClick={() => update({ incomes: plan.incomes.filter(i => i.id !== inc.id) })} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="grid sm:grid-cols-3 lg:grid-cols-7 gap-3">
                  <TextField label="Name" value={inc.name} onChange={v => setIncome(inc.id, { name: v })} />
                  {people.length > 1 && (
                    <SelectField label="Who" value={inc.personId} onChange={v => setIncome(inc.id, { personId: v })}
                      options={people.map(p => ({ value: p.id, label: PERSON_LABEL[p.id] }))} />
                  )}
                  <NumberField label="Annual amount" value={inc.annual} onChange={v => setIncome(inc.id, { annual: v })} hint="Gross, before tax" />
                  <MonthField label="Starts" value={inc.start} onChange={v => setIncome(inc.id, { start: v })} />
                  <MonthField label="Ends (optional)" value={inc.end} onChange={v => setIncome(inc.id, { end: v })} hint="Last month paid. Blank = until retirement" />
                  <NumberField label="Raises" value={inc.growthPct} onChange={v => setIncome(inc.id, { growthPct: v })} suffix="%/yr" step="0.1" />
                  <NumberField label="RRSP contribution" value={inc.rrspPct} onChange={v => setIncome(inc.id, { rrspPct: v })} suffix="% of pay" step="0.5" />
                  <NumberField label="Employer match" value={inc.employerMatchPct} onChange={v => setIncome(inc.id, { employerMatchPct: v })} suffix="% of pay" step="0.5" />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Living costs */}
      <Card title="Spending & housing" subtitle="What life costs today, and what changes when you buy a home.">
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <Field label="Everyday spending">
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg text-xs font-medium mb-2">
                {[['history', 'From my history'], ['custom', 'Enter an amount']].map(([val, label]) => (
                  <button key={val} onClick={() => setLiving({ spendingMode: val })}
                    className={`flex-1 py-1.5 rounded-md transition-colors ${plan.living.spendingMode === val ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {plan.living.spendingMode === 'history' ? (
                <p className="text-sm text-gray-700">
                  {snapshot.historyMonths > 0
                    ? <>Using <span className="font-semibold">{formatCurrency(snapshot.historyMonthly)}/mo</span>, your average over the last {snapshot.historyMonths} full month{snapshot.historyMonths > 1 ? 's' : ''}.</>
                    : 'No spending history yet — enter an amount instead.'}
                </p>
              ) : (
                <NumberField label="Monthly spending" value={plan.living.spendingMonthly} onChange={v => setLiving({ spendingMonthly: v })} hint="Today's dollars, excluding rent and debt payments" />
              )}
            </Field>
            <Toggle label="My spending history already includes rent" checked={plan.living.historyIncludesRent} onChange={v => setLiving({ historyIncludesRent: v })}
              hint="Keeps rent from being counted twice, and removes it when you buy." />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Rent" value={plan.living.rentMonthly} onChange={v => setLiving({ rentMonthly: v })} suffix="/mo" />
              <NumberField label="Rent increases" value={plan.living.rentGrowthPct} onChange={v => setLiving({ rentGrowthPct: v })} suffix="%/yr" step="0.1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 content-start">
            <NumberField label="Spending in retirement" value={plan.living.retirementSpendingPct} onChange={v => setLiving({ retirementSpendingPct: v })} suffix="%" hint="Share of today's spending" />
            <NumberField label="Emergency buffer" value={plan.living.emergencyMonths} onChange={v => setLiving({ emergencyMonths: v })} suffix="months" hint="Kept in cash; the rest is invested" />
            <NumberField label="Cash on hand" value={plan.living.cashOnHand} onChange={v => setLiving({ cashOnHand: v })} hint="Chequing/savings not tracked as a goal or investment" className="col-span-2" />
            <div className="col-span-2 bg-gray-50 rounded-xl p-3 text-xs text-gray-600">
              <p className="flex items-center gap-1.5 font-medium text-gray-700 mb-1"><Wallet className="w-3.5 h-3.5" />Starting money</p>
              <p>{formatCurrency(snapshot.cash)} cash (savings goals {formatCurrency(snapshot.goalsCash)} + cash on hand) and {formatCurrency(snapshot.accounts.reduce((s, a) => s + a.value, 0))} in investments.</p>
              {snapshot.debts.length > 0 && <p className="mt-1">{snapshot.debts.length} debt{snapshot.debts.length > 1 ? 's' : ''} carried in from the Debts page, including any deferred loans.</p>}
            </div>
          </div>
        </div>
      </Card>

      {/* Account registration */}
      <Card title="Account types" subtitle="Tax treatment for each account you track on the Investments page.">
        {state.investments.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No investment accounts yet.</p>
        ) : (
          <div className="space-y-2">
            {state.investments.map(inv => {
              const map = plan.accountMap[inv.id] || {};
              const setMap = patch => update({ accountMap: { ...plan.accountMap, [inv.id]: { bucket: 'nonreg', owner: 'me', ...map, ...patch } } });
              return (
                <div key={inv.id} className="flex flex-wrap items-center gap-3 border border-gray-100 rounded-xl p-3">
                  <div className="flex-1 min-w-40">
                    <p className="text-sm font-medium text-gray-800">{inv.name}</p>
                    <p className="text-xs text-gray-400">{formatCurrency(estimateAccountValue(inv).value)} estimated today</p>
                  </div>
                  <select value={map.bucket || 'nonreg'} onChange={e => setMap({ bucket: e.target.value })} className={`${inputCls} w-56`}>
                    {BUCKETS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                  {people.length > 1 && (
                    <select value={map.owner || 'me'} onChange={e => setMap({ owner: e.target.value })} className={`${inputCls} w-32`}>
                      {people.map(p => <option key={p.id} value={p.id}>{PERSON_LABEL[p.id]}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Assumptions */}
      <Card title="Assumptions" subtitle="The projection is only as good as these. Conservative beats optimistic.">
        <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <NumberField label="Inflation" value={plan.assumptions.inflationPct} onChange={v => setAssumptions({ inflationPct: v })} suffix="%/yr" step="0.1" />
          <NumberField label="Investment return" value={plan.assumptions.returnPct} onChange={v => setAssumptions({ returnPct: v })} suffix="%/yr" step="0.1" hint="Before inflation" />
          <NumberField label="Cash return" value={plan.assumptions.cashReturnPct} onChange={v => setAssumptions({ cashReturnPct: v })} suffix="%/yr" step="0.1" />
          <NumberField label="Home appreciation" value={plan.assumptions.homeAppreciationPct} onChange={v => setAssumptions({ homeAppreciationPct: v })} suffix="%/yr" step="0.1" />
          <NumberField label="Plan through age" value={plan.assumptions.endAge} onChange={v => setAssumptions({ endAge: v })} />
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Ages change on January 1 in the projection, so retirement, CPP and OAS begin in the year you reach that age.
        </p>
        <p className="flex items-start gap-1.5 text-xs text-gray-400 mt-1">
          <Settings2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Tax uses 2026 federal and Ontario brackets, CPP/EI contributions, and the basic personal amounts, indexed each year by your inflation figure.
        </p>
      </Card>
    </div>
  );
}
