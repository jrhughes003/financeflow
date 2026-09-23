import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Home, Car, PartyPopper, Repeat, Trash2, Plus, AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatCurrency } from '../../utils/calculations';
import { housePurchase } from '../../utils/lifeplan/housing';
import { earliestAffordableDate } from '../../utils/lifeplan/engine';
import { newId } from '../../utils/lifeplan/snapshot';
import type { HouseEvent, LifePlan, PlanEvent, PlanEventType } from '../../types/lifeplan';
import type { PlanOutcome, PlanSnapshot, YearEvent } from '../../types/projection';
import { needsSetup } from '../../types/projection';
import { Card, NumberField, TextField, MonthField, SelectField, Toggle } from './ui';

const TYPES: Record<PlanEventType, { label: string; icon: LucideIcon }> = {
  house: { label: 'Home purchase', icon: Home },
  car: { label: 'Vehicle', icon: Car },
  oneTime: { label: 'One-time cost', icon: PartyPopper },
  recurring: { label: 'Ongoing cost', icon: Repeat },
};
const fmtMonth = (d: string | null | undefined): string => (d ? format(parseISO(`${d}-01`), 'MMM yyyy') : '—');

/**
 * One occurrence of an event as the engine recorded it.
 *
 * PlanResult types `eventResults` as `Record<string, unknown>` because each
 * branch of the engine writes a different set of fields, so the fields this
 * screen reads are named here rather than derived.
 */
interface EventResult extends YearEvent {
  date?: string;
  type?: PlanEventType;
  shortfall?: number;
  fromFhsa?: number;
  fromHbp?: number;
  fromSavings?: number;
}

/**
 * A patch from one of the form fields.
 *
 * Not `Partial<PlanEvent>`: NumberField hands back the raw input string, so a
 * numeric field is patched with a string and the engine coerces it on read.
 * Claiming the event's own field types here would misdescribe what is stored.
 */
type EventPatch = Record<string, string | number | boolean | undefined>;

const blank: Record<PlanEventType, () => PlanEvent> = {
  house: () => ({ id: newId('ev'), type: 'house', name: 'Home purchase', date: '', price: 600000, downPct: 20, mortgageRate: 4.5, amortizationYears: 25, firstTime: true, toronto: false, propertyTaxPct: 1, insuranceAnnual: 1800, maintenancePct: 1, condoFeesMonthly: 0, useFHSA: true, useHBP: false }),
  car: () => ({ id: newId('ev'), type: 'car', name: 'Car', date: '', price: 35000, financing: 'loan', downPct: 20, loanRate: 6.5, loanMonths: 60, replaceEveryYears: 0 }),
  oneTime: () => ({ id: newId('ev'), type: 'oneTime', name: 'Wedding', date: '', amount: 30000 }),
  recurring: () => ({ id: newId('ev'), type: 'recurring', name: 'Childcare', start: '', end: '', monthly: 1200, inflate: true }),
};

function Outcome({ results }: { results?: EventResult[] }) {
  if (!results || !results.length) return null;
  const funded = results.every(r => !((r.shortfall ?? 0) > 0.5));
  const first = results[0];
  return (
    <div className={`flex items-start gap-2 rounded-control p-2.5 mt-3 text-caption ${funded ? 'bg-positive-tint text-positive' : 'bg-caution-tint text-caution'}`}>
      {funded ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
      <div>
        {funded ? <p className="font-medium">Affordable as planned.</p> : <p className="font-medium">Short {formatCurrency(first.shortfall ?? 0)} at {fmtMonth(first.date)}.</p>}
        {first.type === 'house' && (
          <p className="mt-0.5">
            Paid with {[(first.fromFhsa ?? 0) > 0 && `${formatCurrency(first.fromFhsa ?? 0)} FHSA`, (first.fromHbp ?? 0) > 0 && `${formatCurrency(first.fromHbp ?? 0)} RRSP (Home Buyers' Plan)`, (first.fromSavings ?? 0) > 0 && `${formatCurrency(first.fromSavings ?? 0)} savings`].filter(Boolean).join(' + ') || 'savings'}.
          </p>
        )}
        {results.length > 1 && <p className="mt-0.5">{results.length} purchases planned: {results.map(r => fmtMonth(r.date)).join(', ')}.</p>}
      </div>
    </div>
  );
}

function HouseDetails({ ev }: { ev: HouseEvent }) {
  const hp = housePurchase({
    price: Number(ev.price) || 0, downPct: Number(ev.downPct) || 0, mortgageRate: Number(ev.mortgageRate) || 0,
    amortizationYears: Number(ev.amortizationYears) || 25, firstTime: ev.firstTime !== false, toronto: !!ev.toronto,
  });
  return (
    <div className="bg-surface-sunk rounded-control p-3 mt-3 text-caption text-ink-secondary">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-y-1 gap-x-4">
        <span>Down payment: <strong>{formatCurrency(hp.downPayment)}</strong></span>
        <span>Land transfer tax: <strong>{formatCurrency(hp.ltt.total)}</strong>{ev.firstTime !== false && ' (after first-time rebate)'}</span>
        <span>CMHC insurance: <strong>{hp.cmhc.premium ? `${formatCurrency(hp.cmhc.premium)} added to the mortgage` : 'none (20%+ down)'}</strong></span>
        <span>Legal & other: <strong>{formatCurrency(hp.legal)}</strong>{hp.cmhc.pst > 0 && ` + ${formatCurrency(hp.cmhc.pst)} PST on insurance`}</span>
        <span className="lg:col-span-2">Cash needed at closing: <strong className="text-ink">{formatCurrency(hp.cashNeeded)}</strong></span>
        <span className="lg:col-span-2">Mortgage {formatCurrency(hp.mortgage)} over {hp.amortizationYears} yrs → <strong className="text-ink">{formatCurrency(hp.monthlyPayment)}/mo</strong></span>
      </div>
      {hp.belowMinimum && (
        <p className="flex items-center gap-1.5 text-caution mt-2"><AlertTriangle className="w-3.5 h-3.5" />Below the minimum down payment in Canada ({formatCurrency(hp.minDown)} for this price).</p>
      )}
    </div>
  );
}

interface PlanEventsProps {
  plan: LifePlan;
  setPlan: (next: LifePlan) => void;
  snapshot: PlanSnapshot;
  result: PlanOutcome;
}

export default function PlanEvents({ plan, setPlan, snapshot, result }: PlanEventsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, string>>({});
  // The page renders this tab whatever runPlan returned, so there may be no
  // projection to read event outcomes or a start month off.
  const projection = needsSetup(result) ? null : result;
  const update = (events: PlanEvent[]) => setPlan({ ...plan, events });
  // The patched event keeps its own `type`, so the spread is still that member
  // of the union — which the spread of an open-ended patch loses.
  const setEvent = (id: string, patch: EventPatch) => update(plan.events.map(e => (e.id === id ? { ...e, ...patch } as PlanEvent : e)));
  const add = (type: PlanEventType) => update([...plan.events, blank[type]()]);

  const findEarliest = (ev: PlanEvent) => {
    setBusy(ev.id);
    // Let the button repaint before the search runs.
    setTimeout(() => {
      const date = earliestAffordableDate(plan, snapshot, ev.id, { maxYears: 25 });
      setFound(f => ({ ...f, [ev.id]: date || 'none' }));
      setBusy(null);
    }, 20);
  };

  return (
    <div className="space-y-5">
      <Card title="Life events" subtitle="Plans with a price tag. Each one is folded into the projection on its date.">
        <div className="flex flex-wrap gap-2">
          {Object.entries(TYPES).map(([type, { label, icon: Icon }]) => (
            <button key={type} onClick={() => add(type as PlanEventType)} className="inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-40 h-9 px-3.5 text-sm border border-line-strong text-ink hover:bg-surface-hover">
              <Plus className="w-3.5 h-3.5" /><Icon className="w-4 h-4 text-ink-muted" />{label}
            </button>
          ))}
        </div>
      </Card>

      {plan.events.length === 0 && (
        <Card><p className="text-sm text-ink-muted text-center py-6">Nothing planned yet. Add a home purchase, a wedding, a car — anything with a date and a cost.</p></Card>
      )}

      {plan.events.map(ev => {
        const { icon: Icon, label } = TYPES[ev.type] || TYPES.oneTime;
        // eventResults is Record<string, unknown>; the engine stores an array
        // of occurrences under each event id.
        const results = projection?.eventResults?.[ev.id] as EventResult[] | undefined;
        const earliest = found[ev.id];
        return (
          <Card key={ev.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-ink-muted" />
                <span className="text-sm font-semibold text-ink">{ev.name || label}</span>
                <span className="text-caption text-ink-muted">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                {ev.type !== 'recurring' && (
                  <button onClick={() => findEarliest(ev)} disabled={busy === ev.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-accent text-accent-ink text-caption font-medium rounded-control hover:bg-accent-tint disabled:opacity-50">
                    <Search className="w-3.5 h-3.5" />{busy === ev.id ? 'Searching…' : 'Earliest affordable date'}
                  </button>
                )}
                <Toggle label="Include" checked={ev.enabled !== false} onChange={v => setEvent(ev.id, { enabled: v })} />
                <button onClick={() => update(plan.events.filter(e => e.id !== ev.id))} className="p-1.5 text-ink-muted hover:text-negative hover:bg-negative-tint rounded-control"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <TextField label="Name" value={ev.name} onChange={v => setEvent(ev.id, { name: v })} />
              {ev.type === 'recurring' ? (
                <>
                  <MonthField label="Starts" value={ev.start} onChange={v => setEvent(ev.id, { start: v })} />
                  <MonthField label="Ends (optional)" value={ev.end} onChange={v => setEvent(ev.id, { end: v })} />
                  <NumberField label="Monthly cost" value={ev.monthly} onChange={v => setEvent(ev.id, { monthly: v })} />
                  <div className="sm:col-span-3"><Toggle label="Rises with inflation" checked={ev.inflate !== false} onChange={v => setEvent(ev.id, { inflate: v })} /></div>
                </>
              ) : (
                <MonthField label="When" value={ev.date} onChange={v => setEvent(ev.id, { date: v })} />
              )}

              {ev.type === 'oneTime' && <NumberField label="Cost" value={ev.amount} onChange={v => setEvent(ev.id, { amount: v })} />}

              {ev.type === 'house' && (
                <>
                  <NumberField label="Purchase price" value={ev.price} onChange={v => setEvent(ev.id, { price: v })} />
                  <NumberField label="Down payment" value={ev.downPct} onChange={v => setEvent(ev.id, { downPct: v })} suffix="%" step="0.5" />
                  <NumberField label="Mortgage rate" value={ev.mortgageRate} onChange={v => setEvent(ev.id, { mortgageRate: v })} suffix="%" step="0.05" />
                  <NumberField label="Amortization" value={ev.amortizationYears} onChange={v => setEvent(ev.id, { amortizationYears: v })} suffix="yrs" />
                  <NumberField label="Property tax" value={ev.propertyTaxPct} onChange={v => setEvent(ev.id, { propertyTaxPct: v })} suffix="%/yr" step="0.05" hint="Of home value; Ontario is roughly 0.6–1.3%" />
                  <NumberField label="Home insurance" value={ev.insuranceAnnual} onChange={v => setEvent(ev.id, { insuranceAnnual: v })} suffix="/yr" />
                  <NumberField label="Upkeep" value={ev.maintenancePct} onChange={v => setEvent(ev.id, { maintenancePct: v })} suffix="%/yr" step="0.1" hint="Of home value" />
                  <NumberField label="Condo fees" value={ev.condoFeesMonthly} onChange={v => setEvent(ev.id, { condoFeesMonthly: v })} suffix="/mo" />
                  <div className="sm:col-span-3 lg:col-span-4 flex flex-wrap gap-4">
                    <Toggle label="First-time buyer" checked={ev.firstTime !== false} onChange={v => setEvent(ev.id, { firstTime: v })} hint="Land transfer tax rebate, 30-yr insured amortization" />
                    <Toggle label="In Toronto" checked={!!ev.toronto} onChange={v => setEvent(ev.id, { toronto: v })} hint="Adds the municipal land transfer tax" />
                    <Toggle label="Use FHSA first" checked={ev.useFHSA !== false} onChange={v => setEvent(ev.id, { useFHSA: v })} />
                    <Toggle label="Use RRSP Home Buyers' Plan" checked={!!ev.useHBP} onChange={v => setEvent(ev.id, { useHBP: v })} hint="Up to $60,000 each, repaid over 15 years" />
                  </div>
                </>
              )}

              {ev.type === 'car' && (
                <>
                  <NumberField label="Price" value={ev.price} onChange={v => setEvent(ev.id, { price: v })} />
                  {/* An event saved before `financing` existed shows the first option either way. */}
                  <SelectField label="Paying by" value={ev.financing ?? 'loan'} onChange={v => setEvent(ev.id, { financing: v })}
                    options={[{ value: 'loan', label: 'Loan' }, { value: 'cash', label: 'Cash' }]} />
                  {ev.financing === 'loan' && <>
                    <NumberField label="Down payment" value={ev.downPct} onChange={v => setEvent(ev.id, { downPct: v })} suffix="%" />
                    <NumberField label="Loan rate" value={ev.loanRate} onChange={v => setEvent(ev.id, { loanRate: v })} suffix="%" step="0.1" />
                    <NumberField label="Loan length" value={ev.loanMonths} onChange={v => setEvent(ev.id, { loanMonths: v })} suffix="months" />
                  </>}
                  <NumberField label="Replace every" value={ev.replaceEveryYears} onChange={v => setEvent(ev.id, { replaceEveryYears: v })} suffix="yrs" hint="0 = just once" />
                </>
              )}
            </div>

            {ev.type === 'house' && <HouseDetails ev={ev} />}
            {(() => {
              // The projection starts next month, so an earlier date never happens.
              const when = ev.type === 'recurring' ? ev.end : ev.date;
              const startYm = projection?.startYm || '';
              if (!when || !startYm || when >= startYm) return null;
              return (
                <p className="flex items-center gap-1.5 text-caption text-caution mt-3">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {ev.type === 'recurring'
                    ? `This ends before the projection starts (${startYm}), so it has no effect.`
                    : `This date is in the past. The projection starts ${startYm}, so this event is skipped — pick a future month.`}
                </p>
              );
            })()}
            <Outcome results={results} />
            {earliest && (
              <p className="text-caption text-ink-secondary mt-2">
                {earliest === 'none'
                  ? 'No affordable month found in the next 25 years at these numbers — more income, a smaller purchase, or a bigger down payment would change that.'
                  : <>Earliest month this works: <span className="font-semibold text-ink">{fmtMonth(earliest)}</span>{' '}
                    <button onClick={() => setEvent(ev.id, { date: earliest })} className="text-accent hover:text-accent-ink font-medium">use this date</button></>}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
