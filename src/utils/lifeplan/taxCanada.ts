// Canadian personal income tax + payroll contributions, federal + Ontario.
//
// ESTIMATES FOR PLANNING — not tax advice. Figures are 2026 values (best
// available when written); later years index brackets and amounts by the
// plan's inflation assumption, which is how CRA indexation works in practice.
// Simplifications: only the most common credits (basic personal amount, CPP/EI,
// Canada employment amount, age amount omitted), no dividend/pension credits,
// Ontario low-income reduction omitted. Capital gains use a 50% inclusion rate.

export const TAX_BASE_YEAR = 2026;

export const FEDERAL = {
  rates: [0.14, 0.205, 0.26, 0.29, 0.33],
  thresholds: [58523, 117045, 181440, 258482],
  // Basic personal amount: full amount phases down to the minimum between the
  // 4th and 5th bracket thresholds.
  bpaMax: 16452,
  bpaMin: 14829,
  canadaEmploymentAmount: 1501,
};

export const ONTARIO = {
  rates: [0.0505, 0.0915, 0.1116, 0.1216, 0.1316],
  thresholds: [53891, 107785, 150000, 220000],
  // The $150k and $220k thresholds are not indexed.
  indexedThresholds: [true, true, false, false],
  bpa: 12989,
  surtax: [{ over: 5818, rate: 0.20 }, { over: 7446, rate: 0.36 }],
};

export const PAYROLL = {
  cpp: { ympe: 74600, yampe: 85000, basicExemption: 3500, baseRate: 0.0495, enhancedRate: 0.01, cpp2Rate: 0.04 },
  ei: { rate: 0.0163, maxInsurable: 68900 },
};

export const REGISTERED = {
  rrspLimit: 33810,     // 18% of earned income, up to this
  rrspPct: 0.18,
  tfsaAnnual: 7000,
  fhsaAnnual: 8000,
  fhsaLifetime: 40000,
  hbpMax: 60000,        // Home Buyers' Plan withdrawal per person
  hbpRepayYears: 15,
};

export const BENEFITS = {
  oasAnnualMax: 8900,       // at 65, full residency
  oasClawbackThreshold: 95300,
  oasClawbackRate: 0.15,
  cppMaxAt65: 17200,        // maximum annual CPP retirement pension at 65
};

export const CAPITAL_GAINS_INCLUSION = 0.5;

import type { Money } from '../../types/domain';

/** Everything here is indexed forward from TAX_BASE_YEAR at this rate. */
export interface TaxYearOptions {
  year?: number;
  inflationPct?: number;
}

export interface PayrollContributions {
  /** Base CPP — earns a tax credit rather than a deduction. */
  cppBase: Money;
  /** Enhanced CPP — deductible from taxable income. */
  cppEnhanced: Money;
  /** CPP2, on earnings between the YMPE and YAMPE. Also deductible. */
  cpp2: Money;
  ei: Money;
  total: Money;
}

export interface TaxableIncome {
  /** Employment income, which drives payroll and the employment amount. */
  employment?: Money;
  /** Fully taxable income: CPP, OAS, RRSP withdrawals, interest. */
  otherTaxable?: Money;
  /** Realised gains; half is included. */
  capitalGains?: Money;
  /** RRSP and FHSA contributions, and anything else deductible. */
  deductions?: Money;
  /** OAS received, needed for the recovery tax. */
  oasReceived?: Money;
}

export interface TaxResult {
  taxable: Money;
  federal: Money;
  /** Ontario tax including surtax, but not the health premium. */
  provincial: Money;
  /** Ontario Health Premium. */
  ohp: Money;
  /** OAS recovery tax. */
  oasClawback: Money;
  payroll: PayrollContributions;
  incomeTax: Money;
  /** Income tax plus payroll — what actually leaves the pay cheque. */
  total: Money;
  /** As a fraction of gross, not a percentage. */
  averageRate: number;
  /** On the next dollar of ordinary income. */
  marginalRate: number;
}

/** [income where the ramp starts, ramp rate, premium at the top of the ramp] */
type OhpStep = readonly [number, number, number];

const round2 = (n: number): Money => Math.round(n * 100) / 100;

/** Inflation index relative to the tax base year. */
export function indexFor(year: number, inflationPct: number): number {
  return Math.pow(1 + inflationPct / 100, Math.max(0, year - TAX_BASE_YEAR));
}

function bracketTax(income: Money, rates: number[], thresholds: number[]): Money {
  let tax = 0;
  let prev = 0;
  for (let i = 0; i < rates.length; i++) {
    const cap = i < thresholds.length ? thresholds[i] : Infinity;
    if (income > prev) tax += (Math.min(income, cap) - prev) * rates[i];
    prev = cap;
  }
  return tax;
}

function marginalFrom(income: Money, rates: number[], thresholds: number[]): number {
  const i = thresholds.findIndex(t => income < t);
  return rates[i === -1 ? rates.length - 1 : i];
}

/** CPP (incl. CPP2) and EI employee contributions on employment income. */
export function payrollContributions(
  employmentIncome: Money,
  { year = TAX_BASE_YEAR, inflationPct = 2 }: TaxYearOptions = {},
): PayrollContributions {
  const idx = indexFor(year, inflationPct);
  const { cpp, ei } = PAYROLL;
  const ympe = cpp.ympe * idx;
  const yampe = cpp.yampe * idx;
  const pensionable = Math.max(0, Math.min(employmentIncome, ympe) - cpp.basicExemption);
  const cppBase = pensionable * cpp.baseRate;          // eligible for a tax credit
  const cppEnhanced = pensionable * cpp.enhancedRate;  // deductible
  const cpp2 = Math.max(0, Math.min(employmentIncome, yampe) - ympe) * cpp.cpp2Rate; // deductible
  const eiPremium = Math.min(employmentIncome, ei.maxInsurable * idx) * ei.rate;
  return {
    cppBase: round2(cppBase),
    cppEnhanced: round2(cppEnhanced),
    cpp2: round2(cpp2),
    ei: round2(eiPremium),
    total: round2(cppBase + cppEnhanced + cpp2 + eiPremium),
  };
}

// Ontario Health Premium: flat plateaus joined by short phase-in ramps.
const OHP_STEPS: readonly OhpStep[] = [
  // [income where the ramp starts, ramp rate, premium reached at the top of the ramp]
  [20000, 0.06, 300],
  [36000, 0.06, 450],
  [48000, 0.25, 600],
  [72000, 0.25, 750],
  [200000, 0.25, 900],
];
export function ontarioHealthPremium(taxable: Money): Money {
  let premium = 0;
  for (const [from, rate, cap] of OHP_STEPS) {
    if (taxable <= from) break;
    premium = Math.min(cap, premium + (taxable - from) * rate);
  }
  return premium;
}

/** Income tax for one person for one year. */
export function computeTax(
  { employment = 0, otherTaxable = 0, capitalGains = 0, deductions = 0, oasReceived = 0 }: TaxableIncome = {},
  { year = TAX_BASE_YEAR, inflationPct = 2 }: TaxYearOptions = {},
): TaxResult {
  const idx = indexFor(year, inflationPct);
  const payroll = payrollContributions(employment, { year, inflationPct });
  const netIncome = Math.max(0, employment + otherTaxable + capitalGains * CAPITAL_GAINS_INCLUSION
    - deductions - payroll.cppEnhanced - payroll.cpp2);
  const taxable = netIncome;

  // Federal
  const fThresholds = FEDERAL.thresholds.map(t => t * idx);
  const lowRate = FEDERAL.rates[0];
  let bpa = FEDERAL.bpaMax * idx;
  const [t4, t5] = [fThresholds[2], fThresholds[3]];
  if (taxable > t4) bpa -= Math.min(1, (taxable - t4) / (t5 - t4)) * (FEDERAL.bpaMax - FEDERAL.bpaMin) * idx;
  const fedCredits = lowRate * (bpa + Math.min(employment, FEDERAL.canadaEmploymentAmount * idx) + payroll.cppBase + payroll.ei);
  const federal = Math.max(0, bracketTax(taxable, FEDERAL.rates, fThresholds) - fedCredits);

  // Ontario
  const oThresholds = ONTARIO.thresholds.map((t, i) => (ONTARIO.indexedThresholds[i] ? t * idx : t));
  const oLow = ONTARIO.rates[0];
  const onCredits = oLow * (ONTARIO.bpa * idx + payroll.cppBase + payroll.ei);
  const basicOn = Math.max(0, bracketTax(taxable, ONTARIO.rates, oThresholds) - onCredits);
  const surtax = ONTARIO.surtax.reduce((s, x) => s + Math.max(0, basicOn - x.over * idx) * x.rate, 0);
  const ohp = ontarioHealthPremium(taxable);
  const provincial = basicOn + surtax;

  // OAS recovery tax
  const oasClawback = Math.min(oasReceived, Math.max(0, netIncome - BENEFITS.oasClawbackThreshold * idx) * BENEFITS.oasClawbackRate);

  const incomeTax = federal + provincial + ohp + oasClawback;
  const gross = employment + otherTaxable + capitalGains;
  // Marginal rate on the next dollar of ordinary income (combined brackets + surtax effect approximated).
  const surtaxFactor = 1 + ONTARIO.surtax.reduce((s, x) => s + (basicOn > x.over * idx ? x.rate : 0), 0);
  const marginalRate = marginalFrom(taxable, FEDERAL.rates, fThresholds) + marginalFrom(taxable, ONTARIO.rates, oThresholds) * surtaxFactor;

  return {
    taxable: round2(taxable),
    federal: round2(federal),
    provincial: round2(provincial),
    ohp: round2(ohp),
    oasClawback: round2(oasClawback),
    payroll,
    incomeTax: round2(incomeTax),
    total: round2(incomeTax + payroll.total),
    averageRate: gross > 0 ? (incomeTax + payroll.total) / gross : 0,
    marginalRate: taxable > 0 ? marginalRate : 0,
  };
}

/** OAS for someone of a given age (full residency assumed), indexed. */
export function oasFor(age: number, startAge: number, year: number, inflationPct: number): Money {
  if (age < Math.max(65, startAge)) return 0;
  const deferralBonus = 1 + Math.min(60, Math.max(0, (startAge - 65) * 12)) * 0.006;
  const age75Bonus = age >= 75 ? 1.1 : 1;
  return BENEFITS.oasAnnualMax * indexFor(year, inflationPct) * deferralBonus * age75Bonus;
}

/** CPP adjusted for start age: −0.6%/month before 65, +0.7%/month after (60–70). */
export function cppFor(
  age: number,
  startAge: number,
  annualAt65TodayDollars: Money,
  year: number,
  inflationPct: number,
): Money {
  if (age < startAge) return 0;
  const months = (Math.min(70, Math.max(60, startAge)) - 65) * 12;
  const factor = months < 0 ? 1 + months * 0.006 : 1 + months * 0.007;
  return annualAt65TodayDollars * factor * indexFor(year, inflationPct);
}
