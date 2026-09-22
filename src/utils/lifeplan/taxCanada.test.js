import { describe, it, expect } from 'vitest';
import {
  computeTax, payrollContributions, ontarioHealthPremium, indexFor, oasFor, cppFor, FEDERAL,
} from './taxCanada';
import {
  minimumDownPayment, cmhcPremium, landTransferTax, mortgagePayment, loanPayment, housePurchase,
} from './housing';

describe('payroll contributions (2026)', () => {
  it('charges CPP on earnings above the basic exemption and EI up to the max', () => {
    const p = payrollContributions(60000);
    expect(p.cppBase).toBeCloseTo((60000 - 3500) * 0.0495, 1);
    expect(p.cppEnhanced).toBeCloseTo((60000 - 3500) * 0.01, 1);
    expect(p.cpp2).toBe(0);
    expect(p.ei).toBeCloseTo(60000 * 0.0163, 1);
  });

  it('caps CPP at the YMPE, adds CPP2 up to the YAMPE, and caps EI', () => {
    const p = payrollContributions(200000);
    expect(p.cppBase + p.cppEnhanced).toBeCloseTo((74600 - 3500) * 0.0595, 1);
    expect(p.cpp2).toBeCloseTo((85000 - 74600) * 0.04, 1);
    expect(p.ei).toBeCloseTo(68900 * 0.0163, 1);
  });
});

describe('Ontario Health Premium', () => {
  it('follows the stepped schedule', () => {
    expect(ontarioHealthPremium(15000)).toBe(0);
    expect(ontarioHealthPremium(22000)).toBeCloseTo(120);
    expect(ontarioHealthPremium(30000)).toBe(300);
    expect(ontarioHealthPremium(37000)).toBeCloseTo(360);
    expect(ontarioHealthPremium(60000)).toBe(600);
    expect(ontarioHealthPremium(100000)).toBe(750);
    expect(ontarioHealthPremium(300000)).toBe(900);
  });
});

describe('computeTax (Ontario, 2026)', () => {
  it('owes nothing below the basic personal amounts', () => {
    const t = computeTax({ otherTaxable: 12000 });
    expect(t.federal).toBe(0);
    expect(t.provincial).toBe(0);
  });

  it('hand-checked case: $60,000 employment income', () => {
    const t = computeTax({ employment: 60000 });
    const p = payrollContributions(60000);
    const taxable = 60000 - p.cppEnhanced;
    const fedGross = 58523 * 0.14 + (taxable - 58523) * 0.205;
    const fedCredits = 0.14 * (16452 + 1501 + p.cppBase + p.ei);
    expect(t.federal).toBeCloseTo(fedGross - fedCredits, 0);
    const onGross = 53891 * 0.0505 + (taxable - 53891) * 0.0915;
    const onCredits = 0.0505 * (12989 + p.cppBase + p.ei);
    expect(t.provincial).toBeCloseTo(onGross - onCredits, 0); // below surtax threshold
    expect(t.ohp).toBe(600);
    // Sanity: total income tax for $60k in Ontario is roughly $8–10k.
    expect(t.incomeTax).toBeGreaterThan(8000);
    expect(t.incomeTax).toBeLessThan(10000);
    expect(t.marginalRate).toBeCloseTo(0.205 + 0.0915, 3);
  });

  it('RRSP deductions lower taxable income; capital gains are half-included', () => {
    const base = computeTax({ employment: 90000 });
    const withRrsp = computeTax({ employment: 90000, deductions: 10000 });
    expect(withRrsp.taxable).toBeCloseTo(base.taxable - 10000, 2);
    expect(withRrsp.incomeTax).toBeLessThan(base.incomeTax);
    const gains = computeTax({ capitalGains: 40000 });
    expect(gains.taxable).toBe(20000);
  });

  it('applies the Ontario surtax at higher incomes and is progressive', () => {
    const rich = computeTax({ employment: 250000 });
    const onBracket = 53891 * 0.0505 + (107785 - 53891) * 0.0915 + (150000 - 107785) * 0.1116
      + (220000 - 150000) * 0.1216 + (rich.taxable - 220000) * 0.1316;
    expect(rich.provincial).toBeGreaterThan(onBracket - 0.0505 * 20000); // surtax pushes it above basic
    const incomes = [30000, 60000, 100000, 150000, 250000].map(e => computeTax({ employment: e }).averageRate);
    incomes.slice(1).forEach((r, i) => expect(r).toBeGreaterThan(incomes[i]));
  });

  it('claws back OAS above the threshold', () => {
    const t = computeTax({ otherTaxable: 120000, oasReceived: 8900 });
    expect(t.oasClawback).toBeCloseTo(Math.min(8900, (120000 - 95300) * 0.15), 0);
  });

  it('indexes brackets with inflation', () => {
    expect(indexFor(2026, 2)).toBe(1);
    expect(indexFor(2028, 2)).toBeCloseTo(1.0404);
    const later = computeTax({ employment: 60000 }, { year: 2036, inflationPct: 2 });
    expect(later.incomeTax).toBeLessThan(computeTax({ employment: 60000 }).incomeTax);
    expect(FEDERAL.thresholds[0]).toBe(58523);
  });
});

describe('CPP / OAS benefits', () => {
  it('adjusts CPP for early/late start and pays OAS from 65', () => {
    expect(cppFor(64, 65, 12000, 2026, 0)).toBe(0);
    expect(cppFor(65, 65, 12000, 2026, 0)).toBe(12000);
    expect(cppFor(60, 60, 12000, 2026, 0)).toBeCloseTo(12000 * 0.64);
    expect(cppFor(70, 70, 12000, 2026, 0)).toBeCloseTo(12000 * 1.42);
    expect(oasFor(64, 65, 2026, 0)).toBe(0);
    expect(oasFor(65, 65, 2026, 0)).toBe(8900);
    expect(oasFor(75, 65, 2026, 0)).toBeCloseTo(8900 * 1.1);
    expect(oasFor(70, 70, 2026, 0)).toBeCloseTo(8900 * 1.36);
  });
});

describe('housing', () => {
  it('computes minimum down payments', () => {
    expect(minimumDownPayment(400000)).toBe(20000);
    expect(minimumDownPayment(700000)).toBe(45000);
    expect(minimumDownPayment(1600000)).toBe(320000);
  });

  it('charges CMHC below 20% down, plus Ontario PST on the premium', () => {
    expect(cmhcPremium(500000, 100000).premium).toBe(0);
    const c = cmhcPremium(500000, 25000);
    expect(c.rate).toBe(0.04);
    expect(c.premium).toBe(19000);
    expect(c.pst).toBe(1520);
    expect(cmhcPremium(500000, 60000).rate).toBe(0.031);
    expect(cmhcPremium(500000, 90000).rate).toBe(0.028);
  });

  it('computes Ontario land transfer tax with the first-time rebate', () => {
    // $500k: 275 + 1950 + 2250 + 2000 = 6475
    expect(landTransferTax(500000, { firstTime: false }).total).toBe(6475);
    expect(landTransferTax(500000).total).toBe(2475);
    expect(landTransferTax(300000).total).toBe(0); // fully rebated
    expect(landTransferTax(500000, { firstTime: false, toronto: true }).total).toBe(12950);
  });

  it('computes Canadian (semi-annual compounding) mortgage payments', () => {
    // $400k, 5%, 25 years ≈ $2,327/mo with semi-annual compounding.
    expect(mortgagePayment(400000, 5, 25)).toBeCloseTo(2326.83, 0);
    expect(mortgagePayment(120000, 0, 10)).toBe(1000);
    expect(loanPayment(30000, 6, 60)).toBeCloseTo(579.98, 1);
  });

  it('puts a house purchase together', () => {
    const h = housePurchase({ price: 600000, downPct: 10, mortgageRate: 4.5, amortizationYears: 30 });
    expect(h.minDown).toBe(35000);
    expect(h.belowMinimum).toBe(false);
    expect(h.cmhc.rate).toBe(0.031);
    expect(h.mortgage).toBe(540000 + 540000 * 0.031);
    expect(h.amortizationYears).toBe(30); // first-time insured buyers can use 30
    expect(h.cashNeeded).toBe(60000 + h.ltt.total + h.cmhc.pst + 2500);
    expect(housePurchase({ price: 600000, downPct: 4 }).belowMinimum).toBe(true);
  });
});
