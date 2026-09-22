import { describe, it, expect } from 'vitest';
import { runPlan, earliestAffordableDate } from './engine';
import { createDefaultPlan, normalizePlan } from './snapshot';
import { computeTax } from './taxCanada';
import { housePurchase } from './housing';

const TODAY = new Date(2026, 8, 22); // Sep 22 2026 → simulation starts Oct 2026

// A plan with growth/inflation switched off unless a test wants them.
const plan = (over = {}) => normalizePlan({
  ...createDefaultPlan(),
  people: [{ id: 'me', birthYear: 2000, retireAge: 65, cppAt65: 0, cppStartAge: 65, oasStartAge: 65 }],
  living: { spendingMode: 'custom', spendingMonthly: 1000, rentMonthly: 0, emergencyMonths: 0, retirementSpendingPct: 100 },
  assumptions: { inflationPct: 0, returnPct: 0, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 30 },
  ...over,
});
const snap = (over = {}) => ({ cash: 0, accounts: [], debts: [], historyMonthly: 0, ...over });
const run = (p, s) => runPlan(p, s, { today: TODAY });
const yearRow = (res, y) => res.rows.find(r => r.year === y);

describe('setup', () => {
  it('asks for setup until a birth year is set', () => {
    expect(runPlan(createDefaultPlan(), snap(), { today: TODAY })).toEqual({ needsSetup: true });
  });

  it('runs from next month to the end age', () => {
    const res = run(plan(), snap({ cash: 100000 }));
    expect(res.startYm).toBe('2026-10');
    expect(res.rows[0]).toMatchObject({ year: 2026, months: 3 }); // Oct–Dec
    expect(res.rows[res.rows.length - 1].year).toBe(2030);        // born 2000, endAge 30
  });
});

describe('spending down savings', () => {
  it('spends cash and reports when it runs out', () => {
    const res = run(plan(), snap({ cash: 12000 }));
    expect(yearRow(res, 2026).balances.liquid).toBeCloseTo(9000, 0); // 3 months × $1,000
    expect(res.firstShortfall.date).toBe('2027-10');                 // 12 months of cash
    expect(yearRow(res, 2027).shortfall).toBeGreaterThan(0);
  });

  it('draws from investments before going short, TFSA before RRSP', () => {
    const res = run(plan(), snap({
      cash: 1000,
      accounts: [
        { id: 'a', bucket: 'nonreg', owner: 'me', value: 6000, acb: 6000 },
        { id: 'b', bucket: 'tfsa', owner: 'me', value: 6000 },
        { id: 'c', bucket: 'rrsp', owner: 'me', value: 12000 },
      ],
    }));
    const r2027 = yearRow(res, 2027);
    expect(r2027.balances.nonreg).toBe(0);          // spent first
    expect(r2027.balances.tfsa).toBe(0);            // then the TFSA
    expect(r2027.balances.rrsp).toBeGreaterThan(0); // RRSP kept for last
    // $25,000 of savings at $1,000/mo lasts 25 months → runs out in Nov 2028.
    expect(res.firstShortfall.date).toBe('2028-11');
    expect(yearRow(res, 2028).balances.liquid).toBe(0);
  });

  it('uses a savings history average when no custom amount is set', () => {
    const p = plan({ living: { spendingMode: 'history', rentMonthly: 500, rentGrowthPct: 0, historyIncludesRent: true, emergencyMonths: 0, retirementSpendingPct: 100 } });
    const res = run(p, snap({ cash: 50000, historyMonthly: 2000 }));
    // 2000 history − 500 rent = 1500 living, + 500 rent = 2000/mo total
    expect(yearRow(res, 2026).spending.total).toBeCloseTo(6000, 0);
    expect(yearRow(res, 2026).spending.housing).toBeCloseTo(1500, 0);
  });
});

describe('income and tax', () => {
  const salary = { id: 'i1', personId: 'me', name: 'Job', start: '2027-01', annual: 60000, growthPct: 0, rrspPct: 0, employerMatchPct: 0 };

  it('starts income on its start date and taxes it like the tax module does', () => {
    const res = run(plan({ incomes: [salary] }), snap({ cash: 20000 }));
    expect(yearRow(res, 2026).income).toBe(0);
    const r = yearRow(res, 2027);
    expect(r.income).toBeCloseTo(60000, 0);
    expect(r.tax).toBeCloseTo(computeTax({ employment: 60000 }, { year: 2027, inflationPct: 0 }).total, 0);
    expect(r.afterTax).toBeCloseTo(60000 - r.tax, 0);
    expect(r.marginalRate).toBeGreaterThan(0.29);
  });

  it('applies raises, RRSP contributions and the employer match', () => {
    const res = run(plan({ incomes: [{ ...salary, growthPct: 10, rrspPct: 10, employerMatchPct: 5 }], people: [{ id: 'me', birthYear: 2000, retireAge: 65, rrspRoom: 100000, cppAt65: 0 }] }), snap({ cash: 20000 }));
    expect(yearRow(res, 2028).income).toBeCloseTo(66000, 0); // +10%
    const r = yearRow(res, 2027);
    expect(r.contributions).toBeCloseTo(6000 + 3000, 0);
    expect(r.balances.rrsp).toBeCloseTo(9000, 0);
    // The RRSP deduction lowers tax versus no contributions.
    expect(r.tax).toBeLessThan(computeTax({ employment: 60000 }, { year: 2027, inflationPct: 0 }).total);
  });

  it('applies each income stream’s own RRSP and match settings', () => {
    const p = plan({
      people: [{ id: 'me', birthYear: 2000, retireAge: 65, rrspRoom: 100000, cppAt65: 0 }],
      incomes: [
        { ...salary, id: 'a', annual: 60000, rrspPct: 10, employerMatchPct: 0 },
        { ...salary, id: 'b', annual: 24000, rrspPct: 0, employerMatchPct: 0 },
      ],
    });
    const r = yearRow(run(p, snap({ cash: 20000 })), 2027);
    expect(r.income).toBeCloseTo(84000, 0);
    // 10% of the first job only — not 10% of both.
    expect(r.contributions).toBeCloseTo(6000, 0);
  });

  it('pays an income through its final month', () => {
    const p = plan({ incomes: [{ ...salary, start: '2027-01', end: '2027-06' }] });
    const r = yearRow(run(p, snap({ cash: 20000 })), 2027);
    expect(r.income).toBeCloseTo(30000, 0); // Jan–Jun inclusive
  });

  it('stops contributing once RRSP room runs out', () => {
    const p = plan({
      people: [{ id: 'me', birthYear: 2000, retireAge: 65, rrspRoom: 2000, cppAt65: 0 }],
      incomes: [{ ...salary, rrspPct: 10, employerMatchPct: 5 }],
    });
    const r = yearRow(run(p, snap({ cash: 20000 })), 2027);
    // Room only allows 2,000 up front; the rest of the year's room accrues for next year.
    expect(r.contributions).toBeCloseTo(2000, 0);
  });

  it('invests surplus into the TFSA first, then non-registered', () => {
    const res = run(plan({
      incomes: [{ ...salary, annual: 120000 }],
      people: [{ id: 'me', birthYear: 2000, retireAge: 65, tfsaRoom: 7000, cppAt65: 0 }],
    }), snap({ cash: 5000 }));
    const r = yearRow(res, 2027);
    expect(r.balances.tfsa).toBeCloseTo(14000, -2); // 7,000 carried + 7,000 new room
    expect(r.balances.nonreg).toBeGreaterThan(0);
    expect(r.invested).toBeGreaterThan(20000);
  });

  it('pays CPP and OAS from 65 and stops employment income at retirement', () => {
    const p = plan({
      people: [{ id: 'me', birthYear: 2000, retireAge: 65, cppAt65: 12000, cppStartAge: 65, oasStartAge: 65 }],
      incomes: [{ ...salary, start: '2026-10' }],
      assumptions: { inflationPct: 0, returnPct: 0, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 67 },
    });
    const res = run(p, snap({ cash: 10000 }));
    expect(yearRow(res, 2064).income).toBeCloseTo(60000, 0);   // age 64, still working
    const retired = yearRow(res, 2065);                         // age 65
    expect(retired.byPerson.me.employment).toBe(0);
    expect(retired.byPerson.me.cpp).toBeCloseTo(12000, 0);
    expect(retired.byPerson.me.oas).toBeCloseTo(8900, 0);
    expect(res.retirementRow.year).toBe(2065);
  });

  it('models a partner separately', () => {
    const p = plan({
      people: [
        { id: 'me', birthYear: 2000, retireAge: 65, cppAt65: 0 },
        { id: 'partner', enabled: true, birthYear: 1998, retireAge: 65, cppAt65: 0 },
      ],
      incomes: [salary, { ...salary, id: 'i2', personId: 'partner', annual: 40000 }],
    });
    const res = run(p, snap({ cash: 10000 }));
    const r = yearRow(res, 2027);
    expect(r.income).toBeCloseTo(100000, 0);
    expect(r.ages).toEqual({ me: 27, partner: 29 });
    // Two people taxed separately pay less than one person earning the total.
    expect(r.tax).toBeLessThan(computeTax({ employment: 100000 }, { year: 2027, inflationPct: 0 }).total);
    expect(r.byPerson.partner.employment).toBeCloseTo(40000, 0);
  });
});

describe('debts', () => {
  it('pays existing debts and waits for deferred loans to start', () => {
    const res = run(plan({ living: { spendingMode: 'custom', spendingMonthly: 0, emergencyMonths: 0, retirementSpendingPct: 100 } }), snap({
      cash: 60000,
      debts: [
        { name: 'Card', balance: 1200, interestRate: 0, minimumPayment: 100 },
        { name: 'Student', balance: 2400, interestRate: 0, minimumPayment: 100, repaymentStart: '2028-01' },
      ],
    }));
    expect(yearRow(res, 2026).spending.debt).toBeCloseTo(300, 0);  // only the card, Oct–Dec
    expect(yearRow(res, 2027).otherDebt).toBeCloseTo(2400, 0);     // card cleared, student untouched
    expect(yearRow(res, 2028).spending.debt).toBeCloseTo(1200, 0); // student loan starts
    expect(yearRow(res, 2030).otherDebt).toBe(0);
  });
});

describe('life events', () => {
  const house = {
    id: 'h1', type: 'house', name: 'House', date: '2028-06', price: 500000, downPct: 20,
    mortgageRate: 4.5, amortizationYears: 25, firstTime: true, propertyTaxPct: 1, insuranceAnnual: 1500, maintenancePct: 1,
  };

  it('buys a house: down payment + closing costs out, mortgage in, rent stops', () => {
    const p = plan({
      living: { spendingMode: 'custom', spendingMonthly: 1000, rentMonthly: 2000, rentGrowthPct: 0, emergencyMonths: 0, retirementSpendingPct: 100 },
      events: [house],
    });
    const res = run(p, snap({ cash: 400000 }));
    const expected = housePurchase({ price: 500000, downPct: 20, mortgageRate: 4.5, amortizationYears: 25, firstTime: true });
    const ev = res.eventResults.h1[0];
    expect(ev.purchase.cashNeeded).toBeCloseTo(expected.cashNeeded, 2);
    expect(ev.shortfall).toBe(0);
    expect(yearRow(res, 2028).homeValue).toBe(500000);
    expect(ev.purchase.mortgage).toBeCloseTo(expected.mortgage, 2);
    // By December it has already been paid down for 7 months.
    expect(yearRow(res, 2028).mortgage).toBeLessThan(expected.mortgage);
    // Before: rent 2,000/mo. After: mortgage + property tax + insurance + upkeep.
    expect(yearRow(res, 2027).spending.housing).toBeCloseTo(24000, 0);
    // Mortgage payments + property tax (1%) + upkeep (1%) + insurance.
    const after = yearRow(res, 2029).spending.housing;
    expect(after).toBeCloseTo(expected.monthlyPayment * 12 + 5000 + 5000 + 1500, -3);
    expect(yearRow(res, 2030).mortgage).toBeLessThan(yearRow(res, 2029).mortgage);
  });

  it('spends the FHSA first and reports a shortfall when savings fall short', () => {
    const p = plan({
      people: [{ id: 'me', birthYear: 2000, retireAge: 65, cppAt65: 0, fhsaAnnual: 8000 }],
      living: { spendingMode: 'custom', spendingMonthly: 0, rentMonthly: 0, emergencyMonths: 0, retirementSpendingPct: 100 },
      events: [house],
    });
    const res = run(p, snap({ cash: 30000 }));
    const ev = res.eventResults.h1[0];
    expect(ev.fromFhsa).toBeGreaterThan(10000);   // 20 months of contributions
    expect(ev.shortfall).toBeGreaterThan(0);      // still not enough for $100k down
    expect(res.firstShortfall.year).toBe(2028);
  });

  it('treats a second home as a move: sells the first and clears its mortgage', () => {
    const p = plan({
      living: { spendingMode: 'custom', spendingMonthly: 0, rentMonthly: 0, emergencyMonths: 0, retirementSpendingPct: 100 },
      assumptions: { inflationPct: 0, returnPct: 0, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 35 },
      events: [
        { ...house, id: 'h1', date: '2028-06', price: 400000, downPct: 20 },
        { ...house, id: 'h2', name: 'Bigger place', date: '2032-06', price: 500000, downPct: 20, sellingCostsPct: 5 },
      ],
    });
    const res = run(p, snap({ cash: 500000 }));
    const move = res.eventResults.h2[0];
    expect(move.soldPreviousHome.value).toBe(400000);
    expect(move.soldPreviousHome.mortgage).toBeGreaterThan(0);
    // Proceeds = value − mortgage − 5% selling costs.
    expect(move.soldPreviousHome.proceeds).toBeCloseTo(400000 - move.soldPreviousHome.mortgage - 20000, 0);
    const after = yearRow(res, 2032);
    expect(after.homeValue).toBe(500000);
    // Only the new mortgage remains — the old one isn't silently wiped.
    expect(after.mortgage).toBeLessThan(400000);
    expect(after.mortgage).toBeGreaterThan(390000);
  });

  it('handles a wedding and a car bought with a loan', () => {
    const p = plan({
      living: { spendingMode: 'custom', spendingMonthly: 0, emergencyMonths: 0, retirementSpendingPct: 100 },
      assumptions: { inflationPct: 0, returnPct: 0, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 35 },
      events: [
        { id: 'w', type: 'oneTime', name: 'Wedding', date: '2027-07', amount: 30000 },
        { id: 'c', type: 'car', name: 'Car', date: '2027-01', price: 40000, financing: 'loan', downPct: 25, loanRate: 6, loanMonths: 60 },
      ],
    });
    const res = run(p, snap({ cash: 100000 }));
    expect(res.eventResults.w[0]).toMatchObject({ amount: 30000, shortfall: 0 });
    expect(res.eventResults.c[0]).toMatchObject({ down: 10000, loan: 30000 });
    expect(yearRow(res, 2027).spending.events).toBeCloseTo(40000, 0); // wedding + down payment
    expect(yearRow(res, 2027).spending.debt).toBeGreaterThan(6000);   // 12 car payments
    expect(yearRow(res, 2032).otherDebt).toBe(0);                     // loan paid off after 5 years
  });

  it('repeats a car purchase on its replacement cycle, at inflated prices', () => {
    const p = plan({
      living: { spendingMode: 'custom', spendingMonthly: 0, emergencyMonths: 0, retirementSpendingPct: 100 },
      assumptions: { inflationPct: 10, returnPct: 0, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 30 },
      events: [{ id: 'c', type: 'car', name: 'Car', date: '2027-01', price: 30000, financing: 'cash', replaceEveryYears: 2 }],
    });
    const res = run(p, snap({ cash: 200000 }));
    const buys = res.eventResults.c;
    expect(buys.map(b => b.date)).toEqual(['2027-01', '2029-01']);
    expect(buys[1].price).toBeCloseTo(30000 * 1.21, 0);
  });
});

describe('earliestAffordableDate', () => {
  it('finds the first month a house works, and it is not affordable a month earlier', () => {
    const house = { id: 'h1', type: 'house', name: 'House', date: '2027-01', price: 400000, downPct: 20, mortgageRate: 4.5, amortizationYears: 25, firstTime: true, propertyTaxPct: 1, insuranceAnnual: 1500, maintenancePct: 1 };
    const p = plan({
      incomes: [{ id: 'i1', personId: 'me', name: 'Job', start: '2026-10', annual: 140000, growthPct: 0, rrspPct: 0, employerMatchPct: 0 }],
      living: { spendingMode: 'custom', spendingMonthly: 2000, rentMonthly: 1500, rentGrowthPct: 0, emergencyMonths: 3, retirementSpendingPct: 100 },
      assumptions: { inflationPct: 0, returnPct: 0, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 40 },
      events: [house],
    });
    const s = snap({ cash: 20000 });
    const date = earliestAffordableDate(p, s, 'h1', { today: TODAY, maxYears: 10 });
    expect(date).toMatch(/^20\d\d-\d\d$/);

    const at = d => run({ ...p, events: [{ ...house, date: d }] }, s);
    expect(at(date).eventResults.h1[0].shortfall).toBe(0);
    const [y, m] = date.split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const prevRes = at(prev);
    expect(prevRes.eventResults.h1[0].shortfall > 0 || prevRes.firstShortfall !== null).toBe(true);
  });
});

describe('inflation', () => {
  it('grows spending and reports an index for today-dollar views', () => {
    const p = plan({ assumptions: { inflationPct: 10, returnPct: 0, cashReturnPct: 0, homeAppreciationPct: 0, endAge: 28 } });
    const res = run(p, snap({ cash: 100000 }));
    expect(yearRow(res, 2028).inflationIndex).toBeCloseTo(Math.pow(1.1, 26 / 12), 3);
    expect(yearRow(res, 2028).spending.living).toBeGreaterThan(yearRow(res, 2027).spending.living * 1.05);
  });
});
