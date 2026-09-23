// Canadian home-purchase math: minimum down payment, CMHC mortgage insurance,
// Ontario land transfer tax (+ optional Toronto municipal LTT), and mortgage
// payments. Estimates for planning.

const round2 = n => Math.round(n * 100) / 100;

/** Minimum down payment: 5% of the first $500k, 10% of the rest; 20% at $1.5M+. */
export function minimumDownPayment(price) {
  if (price >= 1500000) return price * 0.2;
  if (price <= 500000) return price * 0.05;
  return 25000 + (price - 500000) * 0.1;
}

/**
 * CMHC (default insurance) premium, added to the mortgage. Required below 20%
 * down. Ontario also charges 8% PST on the premium, payable in cash at closing.
 */
export function cmhcPremium(price, downPayment) {
  const downPct = price > 0 ? downPayment / price : 1;
  if (downPct >= 0.2) return { rate: 0, premium: 0, pst: 0 };
  const rate = downPct < 0.1 ? 0.04 : downPct < 0.15 ? 0.031 : 0.028;
  const premium = (price - downPayment) * rate;
  return { rate, premium: round2(premium), pst: round2(premium * 0.08) };
}

// Ontario LTT brackets for a single-family residence.
const ON_LTT = [[55000, 0.005], [250000, 0.01], [400000, 0.015], [2000000, 0.02], [Infinity, 0.025]];
// Toronto MLTT (residential), including the luxury tiers above $3M.
const TO_MLTT = [[55000, 0.005], [250000, 0.01], [400000, 0.015], [2000000, 0.02], [3000000, 0.025],
  [4000000, 0.035], [5000000, 0.045], [10000000, 0.055], [20000000, 0.065], [Infinity, 0.075]];

function tiered(price, tiers) {
  let tax = 0, prev = 0;
  for (const [cap, rate] of tiers) {
    if (price > prev) tax += (Math.min(price, cap) - prev) * rate;
    prev = cap;
  }
  return tax;
}

/** Land transfer tax after first-time-buyer rebates. */
export function landTransferTax(price, { firstTime = true, toronto = false } = {}) {
  const provincial = tiered(price, ON_LTT);
  const municipal = toronto ? tiered(price, TO_MLTT) : 0;
  const provRebate = firstTime ? Math.min(4000, provincial) : 0;
  const muniRebate = firstTime && toronto ? Math.min(4475, municipal) : 0;
  return {
    provincial: round2(provincial - provRebate),
    municipal: round2(municipal - muniRebate),
    total: round2(provincial - provRebate + municipal - muniRebate),
  };
}

/** Canadian fixed mortgages compound semi-annually; this is the equivalent monthly rate. */
export function mortgageMonthlyRate(annualPct) {
  return Math.pow(1 + annualPct / 100 / 2, 1 / 6) - 1;
}

export function mortgagePayment(principal, annualPct, amortizationYears) {
  const n = amortizationYears * 12;
  const r = mortgageMonthlyRate(annualPct);
  if (principal <= 0) return 0;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/** Plain monthly-compounded loan payment (car loans). */
export function loanPayment(principal, annualPct, months) {
  const r = annualPct / 100 / 12;
  if (principal <= 0 || months <= 0) return 0;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

/**
 * Everything needed at closing for a house event.
 * @returns { price, downPayment, downPct, minDown, cmhc, ltt, legal, cashNeeded, mortgage, monthlyPayment, belowMinimum }
 */
export function housePurchase({ price, downPct = 20, mortgageRate = 4.5, amortizationYears = 25, firstTime = true, toronto = false, legalAndOther = 2500 }) {
  const downPayment = price * (downPct / 100);
  const minDown = minimumDownPayment(price);
  const cmhc = cmhcPremium(price, downPayment);
  const ltt = landTransferTax(price, { firstTime, toronto });
  const mortgage = price - downPayment + cmhc.premium;
  // Insured (<20% down) mortgages max out at 25 years, or 30 for first-time buyers.
  const maxAmort = cmhc.premium > 0 ? (firstTime ? 30 : 25) : 30;
  const amort = Math.min(amortizationYears, maxAmort);
  return {
    price,
    downPayment: round2(downPayment),
    downPct,
    minDown: round2(minDown),
    belowMinimum: downPayment + 0.005 < minDown,
    cmhc,
    ltt,
    legal: legalAndOther,
    cashNeeded: round2(downPayment + ltt.total + cmhc.pst + legalAndOther),
    mortgage: round2(mortgage),
    amortizationYears: amort,
    monthlyPayment: round2(mortgagePayment(mortgage, mortgageRate, amort)),
  };
}
