// Life-plan projection engine: month-by-month simulation to the end age,
// summarized per calendar year. Pure: pass `today` in; no app state access.
//
// Money model
//   cash          checking/savings (joint)
//   nonreg        taxable investments (joint), with adjusted cost base (ACB)
//   rrsp/tfsa/fhsa  registered accounts, per person
//   home          value + mortgage, once a house event happens
//   debts         existing debts (with deferred starts), car loans, mortgage
//
// Each month: income → tax withholding → registered contributions → spending
// (living, rent or home costs, debt payments, recurring events) → one-time
// events (house, car, wedding…) → surplus above the emergency buffer is
// invested (TFSA first, then non-registered); deficits are covered from cash,
// then non-registered, TFSA, then RRSP → growth. At each year end income tax is
// trued-up using the year's actual RRSP withdrawals and realized gains.

import { computeTax, cppFor, oasFor, indexFor, REGISTERED } from './taxCanada';
import { housePurchase, mortgageMonthlyRate, loanPayment } from './housing';

const round2 = n => Math.round(n * 100) / 100;
const sum = arr => arr.reduce((s, v) => s + v, 0);
const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const parseYm = s => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1 });
const monthsBetween = (a, b) => (b.y - a.y) * 12 + (b.m - a.m);


/**
 * Expand events into dated occurrences (cars repeat every N years).
 * @returns [{ event, date: 'YYYY-MM', occurrence }]
 */
function eventOccurrences(events, endYm) {
  const out = [];
  (events || []).forEach(ev => {
    if (!ev.date || ev.enabled === false) return;
    if (ev.type === 'car' && Number(ev.replaceEveryYears) > 0) {
      const start = parseYm(ev.date);
      for (let i = 0; ; i++) {
        const y = start.y + i * Number(ev.replaceEveryYears);
        const d = ym(y, start.m);
        if (d > endYm) break;
        out.push({ event: ev, date: d, occurrence: i });
      }
    } else if (ev.type !== 'recurring') {
      out.push({ event: ev, date: ev.date.slice(0, 7), occurrence: 0 });
    }
  });
  return out;
}

/**
 * @param plan      the life plan (see defaults.js)
 * @param snapshot  starting point built from app data (see snapshot.js)
 * @returns { needsSetup } or { rows, eventResults, firstShortfall, retirementRow, finalRow }
 */
export function runPlan(plan, snapshot, { today = new Date(), monthlyReturn = null } = {}) {
  const people = (plan.people || []).filter(p => p.id === 'me' || p.enabled);
  const me = people.find(p => p.id === 'me');
  if (!me || !Number(me.birthYear)) return { needsSetup: true };

  const A = plan.assumptions || {};
  const infl = Number(A.inflationPct ?? 2.5);
  const retM = Math.pow(1 + Number(A.returnPct ?? 6) / 100, 1 / 12) - 1;
  // Investment return for month k. Monte Carlo passes a sampler of random
  // market years; otherwise every month earns the steady expected return.
  const returnFor = monthlyReturn || (() => retM);
  const cashM = Math.pow(1 + Number(A.cashReturnPct ?? 2) / 100, 1 / 12) - 1;
  const homeM = Math.pow(1 + Number(A.homeAppreciationPct ?? 3) / 100, 1 / 12) - 1;
  const endAge = Number(A.endAge ?? 95);
  const L = plan.living || {};

  const start = { y: today.getFullYear(), m: today.getMonth() + 1 };
  if (start.m > 11) { start.y++; start.m = 0; }
  const endYear = Number(me.birthYear) + endAge;
  const endYm = ym(endYear, 11);
  const totalMonths = monthsBetween(start, { y: endYear, m: 11 }) + 1;
  const infIdx = k => Math.pow(1 + infl / 100, k / 12);

  // ---- starting balances ----
  const S = snapshot || {};
  let cash = Number(S.cash) || 0;
  const nonreg = { value: 0, acb: 0 };
  const reg = {};
  people.forEach(p => {
    reg[p.id] = {
      rrsp: 0, tfsa: 0, fhsa: 0,
      fhsaLifetime: Number(p.fhsaContributedSoFar) || 0,
      tfsaRoom: Number(p.tfsaRoom) || 0,
      rrspRoom: Number(p.rrspRoom) || 0,
      hbp: 0, hbpRepayFrom: null, hbpAnnual: 0,
    };
  });
  (S.accounts || []).forEach(a => {
    const owner = reg[a.owner] ? a.owner : 'me';
    const v = Number(a.value) || 0;
    if (a.bucket === 'cash') cash += v;
    else if (a.bucket === 'nonreg') { nonreg.value += v; nonreg.acb += Number(a.acb ?? v); }
    else reg[owner][a.bucket] += v;
  });
  const debts = (S.debts || []).map(d => ({
    name: d.name,
    balance: Number(d.balance) || 0,
    r: (Number(d.interestRate) || 0) / 100 / 12,
    payment: Number(d.minimumPayment) || 0,
    startK: d.repaymentStart ? Math.max(0, monthsBetween(start, parseYm(d.repaymentStart))) : 0,
  }));
  const carLoans = [];
  let home = null;
  // Everyday spending in today's dollars: your real average, or a custom figure.
  // If your transaction history already includes rent, take it out so rent
  // isn't counted twice (it's modelled separately and stops when you buy).
  const baselineMonthly = Math.max(0, L.spendingMode === 'custom'
    ? Number(L.spendingMonthly) || 0
    : (Number(S.historyMonthly) || 0) - (L.historyIncludesRent ? Number(L.rentMonthly) || 0 : 0));

  const occurrences = eventOccurrences(plan.events, endYm);
  const eventResults = {};
  const recurring = (plan.events || []).filter(e => e.type === 'recurring' && e.enabled !== false && e.start);

  // ---- helpers ----
  let yr; // per-year accumulators
  const newYear = y => {
    const acc = { year: y, months: 0, byPerson: {}, living: 0, housing: 0, debtPay: 0, eventsSpend: 0, recurringSpend: 0,
      contributions: 0, invested: 0, withdrawals: 0, shortfall: 0, events: [], employerMatch: 0 };
    people.forEach(p => {
      acc.byPerson[p.id] = { employment: 0, cpp: 0, oas: 0, rrspWithdrawals: 0, capGains: 0, deductions: 0, withheld: 0, rrspContrib: 0, fhsaContrib: 0, tfsaWithdrawn: 0 };
    });
    return acc;
  };

  const ageOf = (p, y) => y - Number(p.birthYear);
  const isRetired = (p, y) => ageOf(p, y) >= Number(p.retireAge ?? 65);

  // Each of a person's income streams paying in this month, with its own pay
  // and its own RRSP / employer-match settings. The end month is inclusive.
  const streamsFor = (p, y, m) => (plan.incomes || [])
    .filter(inc => inc.personId === p.id && inc.start)
    .map(inc => {
      const s = parseYm(inc.start);
      const cur = { y, m };
      if (monthsBetween(s, cur) < 0) return null;
      if (inc.end) { if (monthsBetween(parseYm(inc.end), cur) > 0) return null; }
      else if (isRetired(p, y)) return null;
      const pay = (Number(inc.annual) || 0) / 12 * Math.pow(1 + (Number(inc.growthPct) || 0) / 100, y - s.y);
      return pay > 0 ? { inc, pay } : null;
    })
    .filter(Boolean);
  const employmentFor = (p, y, m) => sum(streamsFor(p, y, m).map(s => s.pay));

  // Projected tax rate for the year (withholding), from the year's scheduled income.
  const withholdingRate = {};
  const planYearRates = (y, fromM) => {
    people.forEach(p => {
      let emp = 0, other = 0, oas = 0, ded = 0;
      for (let m = fromM; m < 12; m++) {
        const streams = streamsFor(p, y, m);
        emp += sum(streams.map(s => s.pay));
        ded += sum(streams.map(s => s.pay * (Number(s.inc.rrspPct) || 0) / 100));
        const c = cppFor(ageOf(p, y), Number(p.cppStartAge ?? 65), Number(p.cppAt65 ?? 0), y, infl) / 12;
        const o = oasFor(ageOf(p, y), Number(p.oasStartAge ?? 65), y, infl) / 12;
        other += c + o; oas += o;
      }
      if (!home && Number(p.fhsaAnnual) > 0) ded += Math.min(Number(p.fhsaAnnual), REGISTERED.fhsaAnnual) * (12 - fromM) / 12;
      const gross = emp + other;
      const t = computeTax({ employment: emp, otherTaxable: other, deductions: ded, oasReceived: oas }, { year: y, inflationPct: infl });
      withholdingRate[p.id] = gross > 0 ? t.total / gross : 0;
    });
  };

  const emergencyTarget = monthlyOut => Math.max(0, Number(L.emergencyMonths ?? 3)) * monthlyOut;

  // Pull `amount` from liquid money in a tax-sensible order. Returns the uncovered part.
  const withdraw = amount => {
    let need = amount;
    const take = (avail, fn) => {
      if (need <= 0.005 || avail <= 0.005) return;
      const t = Math.min(need, avail);
      fn(t);
      need -= t;
    };
    take(Math.max(0, cash), t => { cash -= t; });
    take(nonreg.value, t => {
      const gainShare = nonreg.value > 0 ? Math.max(0, 1 - nonreg.acb / nonreg.value) : 0;
      const gain = t * gainShare;
      nonreg.acb -= nonreg.acb * (t / nonreg.value);
      nonreg.value -= t;
      // Joint account: split realized gains between spouses.
      people.forEach(p => { yr.byPerson[p.id].capGains += gain / people.length; });
      yr.withdrawals += t;
    });
    people.forEach(p => take(reg[p.id].tfsa, t => { reg[p.id].tfsa -= t; yr.byPerson[p.id].tfsaWithdrawn += t; yr.withdrawals += t; }));
    // RRSP last; withdrawals are taxable (settled at year end).
    people.forEach(p => take(reg[p.id].rrsp, t => { reg[p.id].rrsp -= t; yr.byPerson[p.id].rrspWithdrawals += t; yr.withdrawals += t; }));
    return Math.max(0, need);
  };

  // Record money the plan couldn't cover. Savings stay at zero rather than
  // going negative — a shortfall means the plan doesn't work from here on.
  const recordShortfall = (amount, y, m, d) => {
    if (amount <= 0.5) return;
    yr.shortfall += amount;
    if (!firstShortfall) firstShortfall = { year: y, month: m, date: d, amount: round2(amount) };
  };

  const invest = amount => {
    let left = amount;
    people.forEach(p => {
      const t = Math.min(left, Math.max(0, reg[p.id].tfsaRoom));
      if (t > 0) { reg[p.id].tfsa += t; reg[p.id].tfsaRoom -= t; left -= t; }
    });
    if (left > 0) { nonreg.value += left; nonreg.acb += left; }
    yr.invested += amount;
  };

  const rows = [];
  let firstShortfall = null;
  yr = newYear(start.y);
  planYearRates(start.y, start.m);

  for (let k = 0; k < totalMonths; k++) {
    const y = start.y + Math.floor((start.m + k) / 12);
    const m = (start.m + k) % 12;
    const d = ym(y, m);
    if (m === 0 && k > 0) {
      yr = newYear(y);
      // New registered room each January.
      people.forEach(p => {
        reg[p.id].tfsaRoom += REGISTERED.tfsaAnnual * indexFor(y, infl);
      });
      planYearRates(y, 0);
    }
    yr.months++;
    const idx = infIdx(k);

    // 1. Income
    let gross = 0, withheld = 0;
    people.forEach(p => {
      const bp = yr.byPerson[p.id];
      const emp = employmentFor(p, y, m);   // total pay this month
      const c = cppFor(ageOf(p, y), Number(p.cppStartAge ?? 65), Number(p.cppAt65 ?? 0), y, infl) / 12;
      const o = oasFor(ageOf(p, y), Number(p.oasStartAge ?? 65), y, infl) / 12;
      bp.employment += emp; bp.cpp += c; bp.oas += o;
      gross += emp + c + o;
      const w = (emp + c + o) * (withholdingRate[p.id] || 0);
      bp.withheld += w; withheld += w;

      // 2. Registered contributions — each stream uses its own settings.
      streamsFor(p, y, m).forEach(({ inc, pay }) => {
        const rr = Math.min(pay * (Number(inc.rrspPct) || 0) / 100, Math.max(0, reg[p.id].rrspRoom));
        const match = Math.min(pay * (Number(inc.employerMatchPct) || 0) / 100, Math.max(0, reg[p.id].rrspRoom - rr));
        if (rr <= 0 && match <= 0) return;
        reg[p.id].rrsp += rr + match;
        // Employer contributions to a group RRSP use up contribution room too.
        reg[p.id].rrspRoom -= rr + match;
        bp.rrspContrib += rr; bp.deductions += rr;
        cash -= rr;
        yr.contributions += rr + match;
        yr.employerMatch += match;
      });
      const fhsaAnnual = Math.min(Number(p.fhsaAnnual) || 0, REGISTERED.fhsaAnnual);
      if (!home && fhsaAnnual > 0 && reg[p.id].fhsaLifetime < REGISTERED.fhsaLifetime) {
        const f = Math.min(fhsaAnnual / 12, REGISTERED.fhsaLifetime - reg[p.id].fhsaLifetime);
        reg[p.id].fhsa += f; reg[p.id].fhsaLifetime += f;
        bp.fhsaContrib += f; bp.deductions += f;
        cash -= f;
        yr.contributions += f;
      }
    });
    cash += gross - withheld;

    // 3. Spending
    const retiredMe = isRetired(me, y);
    const living = baselineMonthly * idx * (retiredMe ? Number(L.retirementSpendingPct ?? 80) / 100 : 1);
    const rent = home ? 0 : (Number(L.rentMonthly) || 0) * Math.pow(1 + Number(L.rentGrowthPct ?? infl) / 100, k / 12);
    let housing = rent;
    if (home) {
      const h = home.params;
      housing += home.value * (Number(h.propertyTaxPct ?? 1) / 100) / 12
        + (Number(h.insuranceAnnual ?? 1500) * idx) / 12
        + home.value * (Number(h.maintenancePct ?? 1) / 100) / 12
        + (Number(h.condoFeesMonthly) || 0) * idx;
      if (home.mortgage > 0.005) {
        const interest = home.mortgage * home.r;
        const pay = Math.min(home.payment, home.mortgage + interest);
        home.mortgage = home.mortgage + interest - pay;
        housing += pay;
      }
    }
    let debtPay = 0;
    debts.forEach(dt => {
      if (dt.balance <= 0.005) return;
      const interest = dt.balance * dt.r;
      if (k >= dt.startK) {
        const pay = Math.min(dt.payment, dt.balance + interest);
        dt.balance = dt.balance + interest - pay;
        debtPay += pay;
      } else dt.balance += interest; // deferred: accrues (0 for interest-free)
    });
    carLoans.forEach(cl => {
      if (cl.balance <= 0.005) return;
      const interest = cl.balance * cl.r;
      const pay = Math.min(cl.payment, cl.balance + interest);
      cl.balance = cl.balance + interest - pay;
      debtPay += pay;
    });
    let recurringSpend = 0;
    recurring.forEach(ev => {
      if (d < ev.start.slice(0, 7) || (ev.end && d > ev.end.slice(0, 7))) return;
      const since = monthsBetween(parseYm(ev.start), { y, m });
      recurringSpend += (Number(ev.monthly) || 0) * (ev.inflate === false ? 1 : Math.pow(1 + infl / 100, since / 12));
    });
    // Home Buyers' Plan repayments: move cash back into the RRSP.
    people.forEach(p => {
      const r = reg[p.id];
      if (r.hbp > 0.005 && r.hbpRepayFrom !== null && y >= r.hbpRepayFrom) {
        const pay = Math.min(r.hbp, r.hbpAnnual / 12);
        r.hbp -= pay; r.rrsp += pay; cash -= pay; yr.contributions += pay;
      }
    });
    cash -= living + housing + debtPay + recurringSpend;
    yr.living += living; yr.housing += housing; yr.debtPay += debtPay; yr.recurringSpend += recurringSpend;

    // 4. One-time events this month
    occurrences.filter(o => o.date === d).forEach(({ event: ev, occurrence }) => {
      const res = { date: d, name: ev.name, type: ev.type, occurrence };
      if (ev.type === 'house') {
        // Moving: sell the current home first (agent/legal costs ~5%).
        if (home) {
          const sellingCosts = home.value * (Number(ev.sellingCostsPct ?? 5) / 100);
          const proceeds = Math.max(0, home.value - home.mortgage - sellingCosts);
          cash += proceeds;
          res.soldPreviousHome = { value: round2(home.value), mortgage: round2(home.mortgage), proceeds: round2(proceeds) };
          home = null;
        }
        const hp = housePurchase({
          price: Number(ev.price) || 0, downPct: Number(ev.downPct ?? 20), mortgageRate: Number(ev.mortgageRate ?? 4.5),
          amortizationYears: Number(ev.amortizationYears ?? 25), firstTime: ev.firstTime !== false, toronto: !!ev.toronto,
        });
        let needCash = hp.cashNeeded;
        let fromFhsa = 0, fromHbp = 0;
        if (ev.useFHSA !== false) people.forEach(p => {
          const t = Math.min(needCash, reg[p.id].fhsa);
          reg[p.id].fhsa -= t; needCash -= t; fromFhsa += t;
        });
        if (ev.useHBP) people.forEach(p => {
          const t = Math.min(needCash, reg[p.id].rrsp, REGISTERED.hbpMax * indexFor(y, 0));
          if (t > 0) {
            reg[p.id].rrsp -= t; needCash -= t; fromHbp += t;
            reg[p.id].hbp += t; reg[p.id].hbpRepayFrom = y + 2; reg[p.id].hbpAnnual = reg[p.id].hbp / REGISTERED.hbpRepayYears;
          }
        });
        // Unused FHSA balance transfers to RRSP tax-free once the home is bought.
        people.forEach(p => { reg[p.id].rrsp += reg[p.id].fhsa; reg[p.id].fhsa = 0; });
        const short = withdraw(needCash);
        home = { value: hp.price, mortgage: hp.mortgage, payment: hp.monthlyPayment, r: mortgageMonthlyRate(Number(ev.mortgageRate ?? 4.5)), params: ev };
        Object.assign(res, { purchase: hp, fromFhsa: round2(fromFhsa), fromHbp: round2(fromHbp), fromSavings: round2(needCash - short), shortfall: round2(short) });
        yr.eventsSpend += hp.cashNeeded - short;
        recordShortfall(short, y, m, d);
      } else if (ev.type === 'car') {
        const price = (Number(ev.price) || 0) * Math.pow(1 + infl / 100, occurrence * Number(ev.replaceEveryYears || 0));
        const loan = ev.financing === 'loan';
        const down = loan ? price * (Number(ev.downPct ?? 10) / 100) : price;
        const short = withdraw(down);
        recordShortfall(short, y, m, d);
        if (loan) {
          const principal = price - down;
          const months = Number(ev.loanMonths ?? 60);
          carLoans.push({ balance: principal, r: (Number(ev.loanRate ?? 6.5) / 100) / 12, payment: loanPayment(principal, Number(ev.loanRate ?? 6.5), months) });
          Object.assign(res, { price: round2(price), down: round2(down), loan: round2(principal), monthlyPayment: round2(loanPayment(principal, Number(ev.loanRate ?? 6.5), months)) });
        } else Object.assign(res, { price: round2(price), down: round2(down) });
        res.shortfall = round2(short);
        yr.eventsSpend += down;
      } else {
        const amount = Number(ev.amount) || 0;
        const short = withdraw(amount);
        recordShortfall(short, y, m, d);
        Object.assign(res, { amount, shortfall: round2(short) });
        yr.eventsSpend += amount - short;
      }
      yr.events.push(res);
      (eventResults[ev.id] = eventResults[ev.id] || []).push(res);
    });

    // 5. Rebalance cash: invest surplus above the buffer, cover any deficit.
    const monthlyOut = living + housing + debtPay + recurringSpend;
    const target = emergencyTarget(monthlyOut);
    if (cash > target) { invest(cash - target); cash = target; }
    else if (cash < 0) {
      const short = withdraw(-cash);
      cash = 0;
      recordShortfall(short, y, m, d);
    }

    // 6. Growth
    if (cash > 0) cash *= 1 + cashM;
    const rM = returnFor(k);
    nonreg.value *= 1 + rM;
    people.forEach(p => { const r = reg[p.id]; r.rrsp *= 1 + rM; r.tfsa *= 1 + rM; r.fhsa *= 1 + rM; });
    if (home) home.value *= 1 + homeM;

    // 7. Year end: settle income tax, grow RRSP room, record the row.
    if (m === 11 || k === totalMonths - 1) {
      let taxTotal = 0, incomeTaxTotal = 0, payrollTotal = 0, trueUp = 0, marginal = 0, grossTotal = 0;
      const byPersonOut = {};
      people.forEach(p => {
        const bp = yr.byPerson[p.id];
        const t = computeTax({
          employment: bp.employment,
          otherTaxable: bp.cpp + bp.oas + bp.rrspWithdrawals,
          capitalGains: bp.capGains,
          deductions: bp.deductions,
          oasReceived: bp.oas,
        }, { year: y, inflationPct: infl });
        trueUp += t.total - bp.withheld;
        taxTotal += t.total; incomeTaxTotal += t.incomeTax; payrollTotal += t.payroll.total;
        grossTotal += bp.employment + bp.cpp + bp.oas;
        if (p.id === 'me') marginal = t.marginalRate;
        reg[p.id].rrspRoom += Math.min(bp.employment * REGISTERED.rrspPct, REGISTERED.rrspLimit * indexFor(y, infl));
        // TFSA withdrawals re-add room next year.
        reg[p.id].tfsaRoom += bp.tfsaWithdrawn;
        byPersonOut[p.id] = {
          age: ageOf(p, y),
          employment: round2(bp.employment), cpp: round2(bp.cpp), oas: round2(bp.oas),
          rrspWithdrawals: round2(bp.rrspWithdrawals), capGains: round2(bp.capGains),
          rrspContrib: round2(bp.rrspContrib), fhsaContrib: round2(bp.fhsaContrib),
          tax: round2(t.total), incomeTax: round2(t.incomeTax), payroll: round2(t.payroll.total),
          averageRate: t.averageRate, marginalRate: t.marginalRate,
        };
      });
      cash -= trueUp;
      if (cash < 0) {
        const short = withdraw(-cash);
        cash = 0;
        recordShortfall(short, y, m, d);
      }

      const regTotals = key => sum(people.map(p => reg[p.id][key]));
      const liquid = cash + nonreg.value + regTotals('tfsa') + regTotals('rrsp') + regTotals('fhsa');
      const otherDebt = sum(debts.map(dt => dt.balance)) + sum(carLoans.map(c => c.balance));
      const mortgage = home ? home.mortgage : 0;
      const homeValue = home ? home.value : 0;
      const spendTotal = yr.living + yr.housing + yr.debtPay + yr.recurringSpend + yr.eventsSpend;
      rows.push({
        year: y,
        months: yr.months,
        ages: Object.fromEntries(people.map(p => [p.id, ageOf(p, y)])),
        retired: retiredMe,
        byPerson: byPersonOut,
        income: round2(grossTotal),
        tax: round2(taxTotal),
        incomeTax: round2(incomeTaxTotal),
        payroll: round2(payrollTotal),
        afterTax: round2(grossTotal - taxTotal),
        averageTaxRate: grossTotal > 0 ? taxTotal / grossTotal : 0,
        marginalRate: marginal,
        spending: {
          living: round2(yr.living), housing: round2(yr.housing), debt: round2(yr.debtPay),
          recurring: round2(yr.recurringSpend), events: round2(yr.eventsSpend), total: round2(spendTotal),
        },
        contributions: round2(yr.contributions),
        employerMatch: round2(yr.employerMatch),
        invested: round2(yr.invested),
        withdrawals: round2(yr.withdrawals),
        shortfall: round2(yr.shortfall),
        events: yr.events,
        balances: {
          cash: round2(cash), nonreg: round2(nonreg.value), tfsa: round2(regTotals('tfsa')),
          rrsp: round2(regTotals('rrsp')), fhsa: round2(regTotals('fhsa')), liquid: round2(liquid),
        },
        homeValue: round2(homeValue),
        mortgage: round2(mortgage),
        otherDebt: round2(otherDebt),
        netWorth: round2(liquid + homeValue - mortgage - otherDebt),
        // Divide by this to express the year in today's dollars.
        inflationIndex: infIdx(k),
      });
    }
  }

  const retireYear = Number(me.birthYear) + Number(me.retireAge ?? 65);
  return {
    rows,
    eventResults,
    firstShortfall,
    retirementRow: rows.find(r => r.year === retireYear) || null,
    finalRow: rows[rows.length - 1] || null,
    startYm: ym(start.y, start.m),
  };
}

/**
 * Earliest month an event could happen without the plan running short before
 * retirement (or at all, if it already fails, before the original failure).
 * Tries each month from now up to `maxYears` ahead.
 */
export function earliestAffordableDate(plan, snapshot, eventId, { today = new Date(), maxYears = 30 } = {}) {
  const ev = (plan.events || []).find(e => e.id === eventId);
  if (!ev) return null;
  const me = plan.people.find(p => p.id === 'me');
  const retireYear = Number(me.birthYear) + Number(me.retireAge ?? 65);
  const ok = res => {
    if (res.needsSetup) return false;
    const funded = (res.eventResults[eventId] || []).every(r => !(r.shortfall > 0.5));
    const earlyFail = res.firstShortfall && res.firstShortfall.year < retireYear;
    return funded && !earlyFail;
  };
  let y = today.getFullYear(), m = today.getMonth() + 1;
  for (let i = 0; i < maxYears * 12; i++, m++) {
    if (m > 11) { m = 0; y++; }
    const date = ym(y, m);
    const trial = { ...plan, events: plan.events.map(e => (e.id === eventId ? { ...e, date } : e)) };
    if (ok(runPlan(trial, snapshot, { today }))) return date;
  }
  return null;
}
