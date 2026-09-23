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
}

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

    // Average gap between consecutive charges.
    let gapSum = 0;
    let gaps = 0;
    for (let i = 1; i < sorted.length; i++) {
      const d0 = parseISO(sorted[i - 1].date);
      const d1 = parseISO(sorted[i].date);
      const gap = differenceInCalendarDays(d1, d0);
      if (gap > 0) { gapSum += gap; gaps++; }
    }
    if (gaps === 0) continue;
    const avgGap = gapSum / gaps;
    const frequency = classifyFrequency(avgGap);
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
      nextDate: advanceDate(last.date, frequency),
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
