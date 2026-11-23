// The subscription audit: every recurring charge with what it costs a year,
// whether its price has crept, and when it last actually charged.
//
// A $16.99 streaming plan is invisible month to month and $204 a year. The
// audit lines them up by yearly cost, and checks the ledger for the thing
// subscriptions do quietly: charge a little more than they used to.

import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { RecurringTemplate, Transaction } from '../types/domain';
import { normaliseMerchant } from './ml/features';
import { toMonthlyAmount } from './calculations';

export interface SubscriptionRow {
  template: RecurringTemplate;
  key: string;
  annual: number;
  /** The most recent ledger charge for this merchant, if any. */
  lastCharged: Transaction | null;
  daysSinceCharged: number | null;
  /** The earliest charge in the lookback, to compare the price against. */
  firstSeen: Transaction | null;
  /** Percent change from firstSeen's amount to the latest; null when there is no history. */
  priceChangePct: number | null;
}

/** How far back to look for a price change. A year catches annual increases. */
const LOOKBACK_DAYS = 400;

/** The ledger's charges for this template, oldest first. */
function chargesFor(template: RecurringTemplate, transactions: Transaction[], key: string, today: Date): Transaction[] {
  return transactions
    .filter(t => t.recurringTemplateId === template.id || (key && normaliseMerchant(t.merchant) === key))
    .filter(t => t.kind !== 'savings' && differenceInCalendarDays(today, parseISO(t.date)) <= LOOKBACK_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function subscriptionAudit(templates: RecurringTemplate[], transactions: Transaction[], today = new Date()): SubscriptionRow[] {
  return templates
    .filter(t => t.active !== false)
    .map(template => {
      const key = normaliseMerchant(template.merchant);
      const charges = chargesFor(template, transactions, key, today);
      const last = charges[charges.length - 1] ?? null;
      const first = charges[0] ?? null;
      const change = first && last && first !== last && first.amount > 0
        ? Math.round(((last.amount - first.amount) / first.amount) * 1000) / 10
        : null;
      return {
        template,
        key,
        annual: Math.round(toMonthlyAmount(Number(template.amount) || 0, template.frequency) * 12 * 100) / 100,
        lastCharged: last,
        daysSinceCharged: last ? differenceInCalendarDays(today, parseISO(last.date)) : null,
        firstSeen: first,
        priceChangePct: change === 0 ? null : change,
      };
    })
    .sort((a, b) => b.annual - a.annual);
}
