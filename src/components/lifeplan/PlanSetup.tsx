import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Table, Th, Td, Tr } from '../ui';
import { formatCurrency } from '../../utils/calculations';
import { estimateAccountValue } from '../../utils/accounts';
import { BUCKETS, newId } from '../../utils/lifeplan/snapshot';
import type {
  AccountMapping, LifePlan, PersonId, PlanAssumptions, PlanIncome, PlanLiving, PlanPerson,
} from '../../types/lifeplan';
import type { AppState } from '../../types/state';
import type { PlanSnapshot } from '../../types/projection';
import { Card, Field, NumberField, TextField, MonthField, SelectField, Toggle, Segmented, inputCls } from './ui';

const PERSON_LABEL: Record<PersonId, string> = { me: 'You', partner: 'Partner' };

/**
 * A patch from one of the form fields.
 *
 * Not a `Partial<...>` of the record being patched: NumberField hands back the
 * raw input string, so a numeric field is patched with a string and the engine
 * coerces it on read. The casts below re-assert the record's own type, which
 * spreading an open-ended patch over it otherwise loses.
 */
type FieldPatch = Record<string, string | number | boolean | undefined>;

interface PlanSetupProps {
  plan: LifePlan;
  setPlan: (next: LifePlan) => void;
  state: AppState;
  snapshot: PlanSnapshot;
}

export default function PlanSetup({ plan, setPlan, state, snapshot }: PlanSetupProps) {
  const update = (patch: Partial<LifePlan>) => setPlan({ ...plan, ...patch });
  const setPerson = (id: PersonId, patch: FieldPatch) => update({ people: plan.people.map(p => (p.id === id ? { ...p, ...patch } as PlanPerson : p)) });
  const setLiving = (patch: FieldPatch) => update({ living: { ...plan.living, ...patch } as PlanLiving });
  const setAssumptions = (patch: FieldPatch) => update({ assumptions: { ...plan.assumptions, ...patch } as PlanAssumptions });
  const setIncome = (id: string, patch: FieldPatch) => update({ incomes: plan.incomes.map(i => (i.id === id ? { ...i, ...patch } as PlanIncome : i)) });
  const people = plan.people.filter(p => p.id === 'me' || p.enabled);

  const addIncome = () => update({
    incomes: [...plan.incomes, {
      id: newId('inc'), personId: 'me', name: 'Salary', start: '', end: '',
      annual: 60000, growthPct: 3, rrspPct: 0, employerMatchPct: 0,
    }],
  });

  return (
    <div className="space-y-2">
      {/* People */}
      <Card title="You & your household" subtitle="Ages drive retirement, CPP and OAS timing." flush>
        {plan.people.map(p => {
          const on = p.id === 'me' || p.enabled;
          return (
            <div key={p.id} className="border-b border-line last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2 min-h-row px-2.5 py-0.5 border-b border-line-faint">
                <span className={`text-caption uppercase tracking-[0.03em] font-semibold ${on ? 'text-ink' : 'text-ink-muted'}`}>{PERSON_LABEL[p.id]}</span>
                {p.id === 'partner' && (
                  <Toggle label="Include a partner in the plan" checked={p.enabled} onChange={v => setPerson('partner', { enabled: v })} />
                )}
              </div>
              {on && (
                <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2 p-2.5">
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
      </Card>

      {/* Income streams */}
      <Card
        title="Income"
        subtitle="Each job or income source, when it starts, and how it grows. Leave the end date blank to run it until retirement."
        meta={plan.incomes.length ? `${plan.incomes.length} STREAM${plan.incomes.length === 1 ? '' : 'S'}` : undefined}
        actions={<Button size="sm" variant="primary" icon={Plus} onClick={addIncome}>Add income</Button>}
        flush
      >
        {plan.incomes.length === 0 ? (
          <p className="font-sans text-sm text-ink-muted p-3">
            No income yet. Add the job you expect to start — that's what makes a house or wedding affordable in the projection.
          </p>
        ) : (
          plan.incomes.map(inc => (
            <div key={inc.id} className="border-b border-line last:border-b-0">
              <div className="flex items-center justify-between gap-2 h-row px-2.5 border-b border-line-faint">
                <span className="text-caption uppercase tracking-[0.03em] font-semibold text-ink truncate">{inc.name || 'Income'}</span>
                <IconButton icon={Trash2} label={`Remove ${inc.name || 'income'}`} variant="danger" onClick={() => update({ incomes: plan.incomes.filter(i => i.id !== inc.id) })} />
              </div>
              <div className="grid sm:grid-cols-3 lg:grid-cols-7 gap-2 p-2.5">
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
          ))
        )}
      </Card>

      {/* Living costs */}
      <Card title="Spending & housing" subtitle="What life costs today, and what changes when you buy a home.">
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-2.5">
            <Field label="Everyday spending">
              <Segmented
                options={[['history', 'From my history'], ['custom', 'Enter an amount']] as const}
                value={plan.living.spendingMode}
                onChange={val => setLiving({ spendingMode: val })}
                className="mb-2"
              />
              {plan.living.spendingMode === 'history' ? (
                <p className="font-sans text-sm text-ink-secondary">
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
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Rent" value={plan.living.rentMonthly} onChange={v => setLiving({ rentMonthly: v })} suffix="/mo" />
              <NumberField label="Rent increases" value={plan.living.rentGrowthPct} onChange={v => setLiving({ rentGrowthPct: v })} suffix="%/yr" step="0.1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 content-start">
            <NumberField label="Spending in retirement" value={plan.living.retirementSpendingPct} onChange={v => setLiving({ retirementSpendingPct: v })} suffix="%" hint="Share of today's spending" />
            <NumberField label="Emergency buffer" value={plan.living.emergencyMonths} onChange={v => setLiving({ emergencyMonths: v })} suffix="months" hint="Kept in cash; the rest is invested" />
            <NumberField label="Cash on hand" value={plan.living.cashOnHand} onChange={v => setLiving({ cashOnHand: v })} hint="Chequing/savings not tracked as a goal or investment" className="col-span-2" />
            <div className="col-span-2 border border-line">
              <p className="label-micro px-2.5 h-[22px] leading-[22px] bg-surface-sunk border-b border-line">Starting money</p>
              <div className="px-2.5 py-1.5 font-sans text-caption text-ink-secondary">
                <p>{formatCurrency(snapshot.cash)} cash (savings goals {formatCurrency(snapshot.goalsCash)} + cash on hand) and {formatCurrency(snapshot.accounts.reduce((s, a) => s + a.value, 0))} in investments.</p>
                {snapshot.debts.length > 0 && <p className="mt-1">{snapshot.debts.length} debt{snapshot.debts.length > 1 ? 's' : ''} carried in from the Debts page, including any deferred loans.</p>}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Account registration */}
      <Card title="Account types" subtitle="Tax treatment for each account you track on the Investments page." flush>
        {state.investments.length === 0 ? (
          <p className="font-sans text-sm text-ink-muted p-3">No investment accounts yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th numeric>Est. today</Th>
                <Th>Registration</Th>
                {people.length > 1 && <Th>Owner</Th>}
              </tr>
            </thead>
            <tbody>
              {state.investments.map(inv => {
                const map: Partial<AccountMapping> = plan.accountMap[inv.id] || {};
                const setMap = (patch: FieldPatch) => update({ accountMap: { ...plan.accountMap, [inv.id]: { bucket: 'nonreg', owner: 'me', ...map, ...patch } as AccountMapping } });
                return (
                  <Tr key={inv.id}>
                    <Td className="text-ink">{inv.name}</Td>
                    <Td numeric className="text-ink-secondary">{formatCurrency(estimateAccountValue(inv).value)} <span className="text-caption text-ink-muted">estimated today</span></Td>
                    <Td className="py-0.5 w-60">
                      <select aria-label={`Account type for ${inv.name}`} value={map.bucket || 'nonreg'} onChange={e => setMap({ bucket: e.target.value })} className={`${inputCls} h-6`}>
                        {BUCKETS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                      </select>
                    </Td>
                    {people.length > 1 && (
                      <Td className="py-0.5 w-36">
                        <select aria-label={`Owner of ${inv.name}`} value={map.owner || 'me'} onChange={e => setMap({ owner: e.target.value })} className={`${inputCls} h-6`}>
                          {people.map(p => <option key={p.id} value={p.id}>{PERSON_LABEL[p.id]}</option>)}
                        </select>
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Assumptions */}
      <Card title="Assumptions" subtitle="The projection is only as good as these. Conservative beats optimistic.">
        <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <NumberField label="Inflation" value={plan.assumptions.inflationPct} onChange={v => setAssumptions({ inflationPct: v })} suffix="%/yr" step="0.1" />
          <NumberField label="Investment return" value={plan.assumptions.returnPct} onChange={v => setAssumptions({ returnPct: v })} suffix="%/yr" step="0.1" hint="Before inflation" />
          <NumberField label="Cash return" value={plan.assumptions.cashReturnPct} onChange={v => setAssumptions({ cashReturnPct: v })} suffix="%/yr" step="0.1" />
          <NumberField label="Home appreciation" value={plan.assumptions.homeAppreciationPct} onChange={v => setAssumptions({ homeAppreciationPct: v })} suffix="%/yr" step="0.1" />
          <NumberField label="Plan through age" value={plan.assumptions.endAge} onChange={v => setAssumptions({ endAge: v })} />
        </div>
        <div className="mt-2.5 pt-2 border-t border-line font-sans text-caption text-ink-muted space-y-1">
          <p>Ages change on January 1 in the projection, so retirement, CPP and OAS begin in the year you reach that age.</p>
          <p>Tax uses 2026 federal and Ontario brackets, CPP/EI contributions, and the basic personal amounts, indexed each year by your inflation figure.</p>
        </div>
      </Card>
    </div>
  );
}
