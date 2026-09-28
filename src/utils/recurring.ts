// Recurring-transaction detection and templates.
//
// Two responsibilities:
//   1. detectRecurringCandidates() — scan history and surface likely recurring
//      charges (same merchant, similar amount, roughly monthly) the user can turn
//      into templates.
//   2. template helpers — decide when a template is "due" and produce the next
//      transaction + advanced date, so the user can post recurring items.

import { parseISO, differenceInCalendarDays, addMonths, addWeeks, addYears, format } from 'date-fns';
import { autoCategorize } from './categorization';
import { detectPeriod, periodLabel } from './periodicity';
import type {
  IsoDate, Money, RecurringFrequency, RecurringTemplate, Transaction,
} from '../types/domain';

/** A charge the history suggests is recurring, before the user confirms it. */
export interface RecurringCandidate {
  merchant: string;
  /** The mean of the observed amounts, not the latest one. */
  amount: Money;
  category: string;
  frequency: RecurringFrequency;
  occurrences: number;
  lastDate: IsoDate;
  nextDate: IsoDate;
  /**
   * How strongly the dates support the cadence, 0-1. Absent when the average-gap
   * fallback found it, which offers no measure of its own confidence.
   */
  confidence?: number;
}

/**
 * Minimum autocorrelation confidence before a cadence is believed.
 *
 * Measured over 3,000 randomly generated date sets: 99.6% scored under 0.4 and
 * nothing reached 0.6, while genuinely messy real patterns still clear it — a
 * skipped month scores 0.82 and a series contaminated by an unrelated one-off
 * 0.74. Note confidence is capped by evidence at (hits-1)/3, so raising this
 * above 0.67 would silently require four occurrences.
 */
const PERIOD_CONFIDENCE = 0.6;

const FREQUENCY_DAYS: Record<RecurringFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  annual: 365,
};

// Normalize a merchant for grouping by its first alphabetic token, so variants
// like "Netflix #123", "NETFLIX", and "netflix.com" all collapse to "netflix".
// (Coarse on purpose — the user confirms detected candidates before they stick.)
function normalizeMerchant(m: string | undefined): string {
  const match = (m || '').toLowerCase().match(/[a-z]+/);
  return match ? match[0] : '';
}

// Classify an average gap (in days) into a known frequency, or null if irregular.
function classifyFrequency(avgGapDays: number): RecurringFrequency | null {
  const candidates = Object.entries(FREQUENCY_DAYS) as [RecurringFrequency, number][];
  for (const [freq, days] of candidates) {
    // Allow ~25% tolerance around the nominal cadence.
    if (Math.abs(avgGapDays - days) <= days * 0.25) return freq;
  }
  return null;
}

/** Find likely recurring charges in transaction history. */
export function detectRecurringCandidates(
  transactions: Transaction[],
  { minOccurrences = 3 }: { minOccurrences?: number } = {},
): RecurringCandidate[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions || []) {
    if (t.isException) continue;
    const key = normalizeMerchant(t.merchant);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }

  const candidates: RecurringCandidate[] = [];
  for (const items of groups.values()) {
    if (items.length < minOccurrences) continue;
    const sorted = [...items].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Autocorrelation over the occurrence dates, with the average-gap rule
    // kept behind it.
    //
    // Averaging gaps is fragile in exactly the ways real statements are messy.
    // One skipped month turns 30/30/30 into 30/30/60/30, whose mean is 37.5 —
    // outside the 25% band around 30, so a monthly subscription with a single
    // missed payment stops being detected at all. An unrelated one-off charge
    // at the same merchant inserts a short gap and does the same. And a bill
    // that drifts across weekends alternates 28/31/30, which averages fine but
    // only by luck.
    //
    // Autocorrelation asks a different question — how much of the whole series
    // this cadence explains — so a single missing or extra point costs a little
    // confidence instead of destroying the answer.
    const dates = sorted.map(t => t.date).filter(Boolean);
    const detected = detectPeriod(dates, { minConfidence: PERIOD_CONFIDENCE });
    const label = detected ? periodLabel(detected.periodDays) : null;

    // periodLabel's vocabulary is wider than a template can express: it also
    // reports semi-monthly, quarterly and semiannual, which RecurringTemplate
    // has no way to store. Those fall through to the gap rule rather than
    // being rounded to the nearest cadence a template can hold.
    const detectedFrequency = label && label in FREQUENCY_DAYS
      ? (label as RecurringFrequency)
      : null;

    // A null detection means the dates were examined and no cadence explains
    // them. Falling back to the average gap there is how the old rule invented
    // subscriptions out of noise: five scattered hardware-store trips have a
    // mean gap of 37.5 days, which lands inside the 25% band around 30 and gets
    // reported as monthly. So the gap rule is only consulted when a real
    // cadence was found and simply cannot be stored — a quarterly or
    // semi-monthly charge, which RecurringTemplate has no field for.
    let frequency: RecurringFrequency | null = detectedFrequency;
    let confidence: number | undefined = detectedFrequency ? detected?.confidence : undefined;

    if (!frequency && !detected) continue;

    if (!frequency) {
      let gapSum = 0;
      let gaps = 0;
      for (let i = 1; i < sorted.length; i++) {
        const d0 = parseISO(sorted[i - 1].date);
        const d1 = parseISO(sorted[i].date);
        const gap = differenceInCalendarDays(d1, d0);
        if (gap > 0) { gapSum += gap; gaps++; }
      }
      if (gaps === 0) continue;
      frequency = classifyFrequency(gapSum / gaps);
      confidence = undefined;
    }
    if (!frequency) continue;

    // Amounts should be reasonably stable (coefficient of variation < 15%).
    const amounts = sorted.map(t => Number(t.amount) || 0);
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    if (mean > 0 && stdDev / mean > 0.15) continue;

    const last = sorted[sorted.length - 1];
    candidates.push({
      merchant: last.merchant,
      amount: Math.round(mean * 100) / 100,
      category: last.category,
      frequency,
      occurrences: sorted.length,
      lastDate: last.date,
      // The detector's own prediction knows the phase of the whole series, so
      // it survives a last charge that landed a few days early. advanceDate
      // only knows the final date, and carries that drift forward.
      nextDate: detectedFrequency && detected ? detected.nextExpected : advanceDate(last.date, frequency),
      ...(confidence === undefined ? {} : { confidence }),
    });
  }

  return candidates.sort((a, b) => b.occurrences - a.occurrences);
}

// Advance a YYYY-MM-DD date by one period of the given frequency.
export function advanceDate(dateStr: IsoDate, frequency: RecurringFrequency): IsoDate {
  const d = parseISO(dateStr);
  let next: Date;
  switch (frequency) {
    case 'weekly': next = addWeeks(d, 1); break;
    case 'biweekly': next = addWeeks(d, 2); break;
    case 'annual': next = addYears(d, 1); break;
    case 'monthly':
    default: next = addMonths(d, 1); break;
  }
  return format(next, 'yyyy-MM-dd');
}

// Is a template due to be posted as of `today` (YYYY-MM-DD)?
export function isTemplateDue(template: RecurringTemplate | null | undefined, today: IsoDate): boolean {
  if (!template || template.active === false || !template.nextDate) return false;
  return template.nextDate <= today;
}

/**
 * Produce the transaction a due template should post, plus the template with its
 * nextDate advanced. Does not mutate inputs.
 */
export function postTemplate(
  template: RecurringTemplate,
  today: IsoDate,
): { transaction: Transaction; template: RecurringTemplate } {
  const tx: Transaction = {
    id: `rec_${template.id}_${template.nextDate}`,
    date: template.nextDate || today,
    merchant: template.merchant,
    amount: Number(template.amount) || 0,
    category: template.category || autoCategorize(template.merchant),
    subcategory: '',
    notes: 'Recurring',
    tags: ['recurring'],
    isException: false,
    recurringTemplateId: template.id,
  };
  const updatedTemplate = {
    ...template,
    nextDate: advanceDate(template.nextDate || today, template.frequency || 'monthly'),
  };
  return { transaction: tx, template: updatedTemplate };
}
