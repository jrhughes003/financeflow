import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Home, Car, PartyPopper, Repeat, Trash2, Plus, AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { formatCurrency } from '../../utils/calculations';
import { housePurchase } from '../../utils/lifeplan/housing';
import { earliestAffordableDate } from '../../utils/lifeplan/engine';
import { newId } from '../../utils/lifeplan/snapshot';
import { Card, NumberField, TextField, MonthField, SelectField, Toggle } from './ui';

const TYPES = {
  house: { label: 'Home purchase', icon: Home },
  car: { label: 'Vehicle', icon: Car },
  oneTime: { label: 'One-time cost', icon: PartyPopper },
  recurring: { label: 'Ongoing cost', icon: Repeat },
};
const fmtMonth = d => (d ? format(parseISO(`${d}-01`), 'MMM yyyy') : '—');

const blank = {
  house: () => ({ id: newId('ev'), type: 'house', name: 'Home purchase', date: '', price: 600000, downPct: 20, mortgageRate: 4.5, amortizationYears: 25, firstTime: true, toronto: false, propertyTaxPct: 1, insuranceAnnual: 1800, maintenancePct: 1, condoFeesMonthly: 0, useFHSA: true, useHBP: false }),
  car: () => ({ id: newId('ev'), type: 'car', name: 'Car', date: '', price: 35000, financing: 'loan', downPct: 20, loanRate: 6.5, loanMonths: 60, replaceEveryYears: 0 }),
  oneTime: () => ({ id: newId('ev'), type: 'oneTime', name: 'Wedding', date: '', amount: 30000 }),
  recurring: () => ({ id: newId('ev'), type: 'recurring', name: 'Childcare', start: '', end: '', monthly: 1200, inflate: true }),
};

function Outcome({ results }) {
  if (!results || !results.length) return null;
  const funded = results.every(r => !(r.shortfall > 0.5));
  const first = results[0];
  return (
    <div className={`flex items-start gap-2 rounded-lg p-2.5 mt-3 text-xs ${funded ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
      {funded ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
      <div>
        {funded ? <p className="font-medium">Affordable as planned.</p> : <p className="font-medium">Short {formatCurrency(first.shortfall)} at {fmtMonth(first.date)}.</p>}
        {first.type === 'house' && (
          <p className="mt-0.5">
            Paid with {[first.fromFhsa > 0 && `${formatCurrency(first.fromFhsa)} FHSA`, first.fromHbp > 0 && `${formatCurrency(first.fromHbp)} RRSP (Home Buyers' Plan)`, first.fromSavings > 0 && `${formatCurrency(first.fromSavings)} savings`].filter(Boolean).join(' + ') || 'savings'}.
          </p>
        )}
        {results.length > 1 && <p className="mt-0.5">{results.length} purchases planned: {results.map(r => fmtMonth(r.date)).join(', ')}.</p>}
      </div>
    </div>
  );
}

function HouseDetails({ ev }) {
  const hp = housePurchase({
    price: Number(ev.price) || 0, downPct: Number(ev.downPct) || 0, mortgageRate: Number(ev.mortgageRate) || 0,
    amortizationYears: Number(ev.amortizationYears) || 25, firstTime: ev.firstTime !== false, toronto: !!ev.toronto,
  });
  return (
    <div className="bg-gray-50 rounded-lg p-3 mt-3 text-xs text-gray-700">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-y-1 gap-x-4">
        <span>Down payment: <strong>{formatCurrency(hp.downPayment)}</strong></span>
        <span>Land transfer tax: <strong>{formatCurrency(hp.ltt.total)}</strong>{ev.firstTime !== false && ' (after first-time rebate)'}</span>
        <span>CMHC insurance: <strong>{hp.cmhc.premium ? `${formatCurrency(hp.cmhc.premium)} added to the mortgage` : 'none (20%+ down)'}</strong></span>
        <span>Legal & other: <strong>{formatCurrency(hp.legal)}</strong>{hp.cmhc.pst > 0 && ` + ${formatCurrency(hp.cmhc.pst)} PST on insurance`}</span>
        <span className="lg:col-span-2">Cash needed at closing: <strong className="text-gray-900">{formatCurrency(hp.cashNeeded)}</strong></span>
        <span className="lg:col-span-2">Mortgage {formatCurrency(hp.mortgage)} over {hp.amortizationYears} yrs → <strong className="text-gray-900">{formatCurrency(hp.monthlyPayment)}/mo</strong></span>
      </div>
      {hp.belowMinimum && (
        <p className="flex items-center gap-1.5 text-amber-700 mt-2"><AlertTriangle className="w-3.5 h-3.5" />Below the minimum down payment in Canada ({formatCurrency(hp.minDown)} for this price).</p>
      )}
    </div>
  );
}

export default function PlanEvents({ plan, setPlan, snapshot, result }) {
  const [busy, setBusy] = useState(null);
  const [found, setFound] = useState({});
  const update = events => setPlan({ ...plan, events });
  const setEvent = (id, patch) => update(plan.events.map(e => (e.id === id ? { ...e, ...patch } : e)));
  const add = type => update([...plan.events, blank[type]()]);

  const findEarliest = ev => {
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
            <button key={type} onClick={() => add(type)} className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Plus className="w-3.5 h-3.5" /><Icon className="w-4 h-4 text-gray-500" />{label}
            </button>
          ))}
        </div>
      </Card>

      {plan.events.length === 0 && (
        <Card><p className="text-sm text-gray-400 text-center py-6">Nothing planned yet. Add a home purchase, a wedding, a car — anything with a date and a cost.</p></Card>
      )}

      {plan.events.map(ev => {
        const { icon: Icon, label } = TYPES[ev.type] || TYPES.oneTime;
        const results = result.eventResults?.[ev.id];
        const earliest = found[ev.id];
        return (
          <Card key={ev.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-900">{ev.name || label}</span>
                <span className="text-xs text-gray-400">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                {ev.type !== 'recurring' && (
                  <button onClick={() => findEarliest(ev)} disabled={busy === ev.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-blue-200 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-50 disabled:opacity-50">
                    <Search className="w-3.5 h-3.5" />{busy === ev.id ? 'Searching…' : 'Earliest affordable date'}
                  </button>
                )}
                <Toggle label="Include" checked={ev.enabled !== false} onChange={v => setEvent(ev.id, { enabled: v })} />
                <button onClick={() => update(plan.events.filter(e => e.id !== ev.id))} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
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
                  <SelectField label="Paying by" value={ev.financing} onChange={v => setEvent(ev.id, { financing: v })}
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
              const startYm = result.startYm || '';
              if (!when || !startYm || when >= startYm) return null;
              return (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 mt-3">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {ev.type === 'recurring'
                    ? `This ends before the projection starts (${startYm}), so it has no effect.`
                    : `This date is in the past. The projection starts ${startYm}, so this event is skipped — pick a future month.`}
                </p>
              );
            })()}
            <Outcome results={results} />
            {earliest && (
              <p className="text-xs text-gray-600 mt-2">
                {earliest === 'none'
                  ? 'No affordable month found in the next 25 years at these numbers — more income, a smaller purchase, or a bigger down payment would change that.'
                  : <>Earliest month this works: <span className="font-semibold text-gray-900">{fmtMonth(earliest)}</span>{' '}
                    <button onClick={() => setEvent(ev.id, { date: earliest })} className="text-blue-600 hover:text-blue-700 font-medium">use this date</button></>}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
