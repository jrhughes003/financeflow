// The three-tier categorisation fallback is what this file exists to pin.
//
// categorizeOnBlur asks, cheapest first: the keyword matcher, then the local
// classifier trained on this ledger, then the AI. The comment above it records
// a measurement — where keywords fall back the classifier is right about three
// times in four, but on a merchant nobody has ever seen it is *worse* than
// keywords, which is why it never overrides them. That ordering is therefore a
// decision, not an accident, and a refactor that swapped two tiers would still
// look correct while quietly making categorisation worse.
//
// So the assertions here are about which tiers RAN, not only about the answer:
// every test that expects an earlier tier to handle a merchant also asserts
// that the later ones were never called.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TransactionEntry from './TransactionEntry';
import { runAi } from '../ai/ai';
import { classify } from '../utils/ml/categorizer';
import { makeState, makeSettings, makeTransaction, makeGoal, makeOwed } from '../test/factories';
import type { Classification, TrainedClassifier } from '../utils/ml/categorizer';
import type { Action, AppState } from '../types/state';

// --- Doubles ----------------------------------------------------------------

// The context is stubbed rather than driven through FinancialProvider because
// these tests need to vary `settings.aiEnabled` and the ledger the classifier
// trains on, and to read the dispatched action directly. Same shape the
// provider hands consumers. (CommandPalette.test.tsx does the same.)
let state: AppState = makeState();
const dispatch = vi.fn();
vi.mock('../context/FinancialContext', () => ({ useFinancial: () => ({ state, dispatch }) }));

// Mocked at the module boundary, not at the network: runAi is the only door to
// the Electron AI bridge, so with this module stubbed no real call is
// reachable from the component at all. aiSupported is forced on so that
// `aiEnabled` is decided purely by settings, which is what the tests vary.
vi.mock('../ai/ai', () => ({
  aiSupported: true,
  runAi: vi.fn(),
  taxonomy: vi.fn(() => [{ id: 'groceries', name: 'Groceries' }]),
}));

// The real classifier, wrapped in a spy. Real by default — the point of tier 2
// is that it learns from this ledger, and a fully faked classifier would not
// prove that. The override exists only for the answers that are awkward to
// train for on purpose (a confident "products", an unconfident anything).
let classifyResult: Classification | null | undefined;
vi.mock('../utils/ml/categorizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/ml/categorizer')>();
  return {
    ...actual,
    classify: vi.fn((model: TrainedClassifier | null, merchant: string) => (
      classifyResult === undefined ? actual.classify(model, merchant) : classifyResult
    )),
  };
});

// --- Fixtures ---------------------------------------------------------------

// Two merchants no keyword list contains, each seen often enough for train()
// to clear MIN_EXAMPLES. This is tier 2's whole premise: the corner shop the
// user actually visits, which only their own ledger knows about.
const learnedLedger = [
  ...Array.from({ length: 7 }, (_, i) => makeTransaction({ id: `g${i}`, merchant: 'Zyxo Mart', category: 'groceries' })),
  ...Array.from({ length: 7 }, (_, i) => makeTransaction({ id: `d${i}`, merchant: 'Qwib Diner', category: 'dining_out' })),
];

/** A merchant that no keyword matches and the trained model cannot vectorise. */
const UNSEEN = 'Blorptronix';

const withAi = (over: Partial<AppState> = {}): Partial<AppState> => ({
  ...over,
  settings: makeSettings({ aiEnabled: true, ...over.settings }),
});

const renderEntry = (
  over: Partial<AppState> = {},
  props: React.ComponentProps<typeof TransactionEntry> = {},
) => {
  state = makeState(over);
  return render(<TransactionEntry {...props} />);
};

// --- Queries ----------------------------------------------------------------

const amount = () => screen.getByLabelText('Amount');
const merchant = () => screen.getByLabelText('Merchant / Description');
const category = () => screen.getByLabelText('Category');
const tags = () => screen.getByLabelText('Tags (comma-separated)');
const submit = (name: string | RegExp = 'Add Transaction') => screen.getByRole('button', { name });
const suggestionButton = () => screen.queryByRole('button', { name: /Auto-categorize as/ });

const typeMerchant = (value: string) => fireEvent.change(merchant(), { target: { value } });

// categorizeOnBlur is async once it reaches the AI tier, so the blur has to be
// flushed inside act(); otherwise the assertion races the state update and
// React 19 warns about updating outside act.
const blurMerchant = async () => { await act(async () => { fireEvent.blur(merchant()); }); };

/** The first dispatched action of a type, narrowed so a miss fails loudly. */
const dispatched = (type: Action['type']): Action | undefined =>
  dispatch.mock.calls.map(call => call[0] as Action).find(action => action.type === type);

beforeEach(() => {
  vi.clearAllMocks();
  classifyResult = undefined;
  // A default so an unexpected AI call is visible as a wrong suggestion rather
  // than as a TypeError on `res.ok`.
  vi.mocked(runAi).mockResolvedValue({ ok: false, error: 'unavailable' });
});

// --- Tier 1: keywords -------------------------------------------------------

describe('categorisation tier 1 — keywords', () => {
  it('suggests from a keyword as the merchant is typed, consulting nothing else', () => {
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant('Starbucks');
    expect(suggestionButton()).toHaveTextContent('Auto-categorize as "Dining Out"');
    expect(classify).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  // The `!== 'products'` early return, reached with no suggestion already on
  // screen: an edited transaction arrives with a merchant that was never typed
  // into this form, so nothing has run handleMerchantChange for it.
  it('stops at keywords on blur, without touching the classifier or the AI', async () => {
    renderEntry(
      withAi({ transactions: learnedLedger }),
      { editTransaction: makeTransaction({ merchant: 'Starbucks', category: '' }) },
    );
    await blurMerchant();
    expect(classify).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
    expect(suggestionButton()).not.toBeInTheDocument();
  });
});

// --- Tier 2: the local classifier ------------------------------------------

describe('categorisation tier 2 — the local classifier', () => {
  it('categorises a merchant only this ledger knows about, without calling the AI', async () => {
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant('Zyxo Mart'); // no keyword matches it; the ledger does
    expect(suggestionButton()).not.toBeInTheDocument();
    await blurMerchant();
    expect(suggestionButton()).toHaveTextContent('Auto-categorize as "Groceries"');
    // The whole point of putting the classifier ahead of the AI: no round trip.
    expect(runAi).not.toHaveBeenCalled();
  });

  // A confident "products" is the catch-all, not an answer, so it must not be
  // suggested — and must not stop the chain either.
  it('rejects a confident "products" and falls through to the AI', async () => {
    classifyResult = { category: 'products', confidence: 0.97, confident: true, probabilities: { products: 0.97 } };
    vi.mocked(runAi).mockResolvedValue({ ok: true, data: { category: 'transportation' } });
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant(UNSEEN);
    await blurMerchant();
    expect(runAi).toHaveBeenCalledTimes(1);
    expect(suggestionButton()).toHaveTextContent('Auto-categorize as "Transportation"');
  });

  it('does not suggest an answer the classifier is not confident about', async () => {
    classifyResult = { category: 'groceries', confidence: 0.41, confident: false, probabilities: { groceries: 0.41 } };
    renderEntry({ transactions: learnedLedger }); // AI off, so nothing else can answer
    typeMerchant(UNSEEN);
    await blurMerchant();
    expect(suggestionButton()).not.toBeInTheDocument();
  });
});

// --- Tier 3: the AI ---------------------------------------------------------

describe('categorisation tier 3 — the AI', () => {
  it('is reached only once keywords and the classifier have both passed', async () => {
    vi.mocked(runAi).mockResolvedValue({ ok: true, data: { category: 'subscriptions' } });
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant(UNSEEN); // unknown to keywords, and unvectorisable by the model
    await blurMerchant();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(runAi).toHaveBeenCalledWith('categorize', {
      merchant: UNSEEN,
      categories: [{ id: 'groceries', name: 'Groceries' }],
    });
    expect(suggestionButton()).toHaveTextContent('Auto-categorize as "Subscriptions"');
  });

  it('never calls out when AI is disabled', async () => {
    renderEntry({ transactions: learnedLedger }); // settings.aiEnabled unset
    typeMerchant(UNSEEN);
    await blurMerchant();
    expect(classify).toHaveBeenCalledTimes(1); // the free tiers still run
    expect(runAi).not.toHaveBeenCalled();
    expect(suggestionButton()).not.toBeInTheDocument();
  });

  it('ignores a "products" suggestion from the AI', async () => {
    vi.mocked(runAi).mockResolvedValue({ ok: true, data: { category: 'products' } });
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant(UNSEEN);
    await blurMerchant();
    expect(runAi).toHaveBeenCalledTimes(1);
    expect(suggestionButton()).not.toBeInTheDocument();
  });

  it('suggests nothing when the AI call fails', async () => {
    vi.mocked(runAi).mockResolvedValue({ ok: false, error: 'no_key' });
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant(UNSEEN);
    await blurMerchant();
    expect(suggestionButton()).not.toBeInTheDocument();
  });
});

// --- The guards in front of all three --------------------------------------

describe('categorisation guards', () => {
  it('does not categorise once a category has been chosen', async () => {
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant(UNSEEN);
    fireEvent.change(category(), { target: { value: 'groceries' } });
    await blurMerchant();
    expect(classify).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  // A learned merchant→category hint fills the suggestion without any keyword
  // matching, which isolates the `suggestion` guard from the keyword one.
  it('does not categorise when a suggestion is already on screen', async () => {
    renderEntry(withAi({
      transactions: learnedLedger,
      settings: makeSettings({ aiEnabled: true, merchantCategoryHints: { blorptronix: 'transportation' } }),
    }));
    typeMerchant(UNSEEN);
    expect(suggestionButton()).toHaveTextContent('Auto-categorize as "Transportation"');
    await blurMerchant();
    expect(classify).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  it('ignores a merchant shorter than three characters', async () => {
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant('Zy');
    await blurMerchant();
    expect(classify).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  it('categorises at exactly three characters', async () => {
    renderEntry(withAi({ transactions: learnedLedger }));
    typeMerchant('Zyx'); // the boundary: length < 3 is the guard
    await blurMerchant();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(suggestionButton()).toHaveTextContent('Auto-categorize as "Groceries"');
  });

  // The isSavings guard cannot be reached through the UI — the merchant input
  // is itself gated on !isSavings, so there is no field left to blur. Pinning
  // the reachable half: switching to savings removes every categorisable
  // field, so nothing can be sent anywhere.
  it('has nothing to categorise in savings mode', () => {
    renderEntry(withAi({ transactions: learnedLedger, savings_goals: [makeGoal({ name: 'Japan Trip' })] }));
    typeMerchant('Zyxo Mart');
    fireEvent.click(screen.getByRole('button', { name: 'Savings' }));
    expect(screen.queryByLabelText('Merchant / Description')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
    expect(runAi).not.toHaveBeenCalled();
  });
});

// --- Applying a suggestion --------------------------------------------------

describe('applying a suggestion', () => {
  // The subcategory belongs to the old category, so leaving it behind would
  // save "Dining Out / Supermarket".
  it('sets the category and clears the subcategory', () => {
    renderEntry();
    fireEvent.change(category(), { target: { value: 'groceries' } });
    fireEvent.change(screen.getByLabelText('Subcategory'), { target: { value: 'Supermarket' } });
    expect(screen.getByLabelText('Subcategory')).toHaveValue('Supermarket');

    typeMerchant('Starbucks');
    const apply = suggestionButton();
    if (!apply) throw new Error('unreachable: the keyword match should have offered a suggestion');
    fireEvent.click(apply);

    expect(category()).toHaveValue('dining_out');
    expect(screen.getByLabelText('Subcategory')).toHaveValue('');
    expect(suggestionButton()).not.toBeInTheDocument();
  });
});

// --- Validation and submission ---------------------------------------------

describe('validation', () => {
  it('rejects an empty expense with one message per field', () => {
    renderEntry();
    fireEvent.click(submit());
    expect(screen.getByText('Enter a valid amount')).toBeInTheDocument();
    expect(screen.getByText('Merchant is required')).toBeInTheDocument();
    expect(screen.getByText('Select a category')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a zero amount', () => {
    renderEntry();
    fireEvent.change(amount(), { target: { value: '0' } });
    fireEvent.change(merchant(), { target: { value: 'Zyxo Mart' } });
    fireEvent.change(category(), { target: { value: 'groceries' } });
    fireEvent.click(submit());
    expect(screen.getByText('Enter a valid amount')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('requires a goal for a savings contribution, and no merchant or category', () => {
    renderEntry({ savings_goals: [makeGoal({ id: 'g1', name: 'Japan Trip' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Savings' }));
    fireEvent.change(amount(), { target: { value: '250' } });
    fireEvent.click(submit());
    expect(screen.getByText('Choose a goal to contribute to')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('the owed rules', () => {
  const fillFrontedPurchase = () => {
    fireEvent.change(amount(), { target: { value: '100' } });
    fireEvent.change(merchant(), { target: { value: 'Zyxo Mart' } });
    fireEvent.change(category(), { target: { value: 'groceries' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /they owe me back/i }));
  };

  // Neither owed sub-field has a label of its own; the purchase amount is the
  // only other number input, so the second spinbutton is the people count.
  const owedPeople = () => screen.getAllByRole('spinbutton')[1];

  // Cleared rather than set to 1: the input carries min="2", so native
  // constraint validation blocks a submit with 1 in it before handleSubmit is
  // ever reached. A blank field is the way a user actually reaches this rule.
  it('needs at least two people for an even split', () => {
    renderEntry();
    fillFrontedPurchase();
    fireEvent.change(owedPeople(), { target: { value: '' } });
    fireEvent.click(submit());
    expect(screen.getByText('Split between at least 2 people')).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('refuses to be owed more than the purchase cost', () => {
    renderEntry();
    fillFrontedPurchase();
    fireEvent.click(screen.getByRole('button', { name: 'Exact amount' }));
    fireEvent.change(screen.getByPlaceholderText('Amount owed to you'), { target: { value: '150' } });
    fireEvent.click(submit());
    expect(screen.getByText("Can't be owed more than the purchase amount")).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  // Money that has already come back cannot be un-owed: it would leave the
  // repayment larger than the debt it repaid.
  it('will not drop the owed amount below what has already been repaid', () => {
    const fronted = makeTransaction({
      id: 'tx_owed', merchant: 'Zyxo Mart', amount: 100, category: 'groceries',
      owed: makeOwed({ amount: 60, payments: [{ id: 'p1', date: '2026-09-01', amount: 30 }] }),
    });
    renderEntry({}, { editTransaction: fronted });
    fireEvent.change(screen.getByPlaceholderText('Amount owed to you'), { target: { value: '20' } });
    fireEvent.click(submit('Save Changes'));
    expect(screen.getByText(/already been paid back/)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('saves an even split as an owed record', () => {
    renderEntry();
    fillFrontedPurchase();
    fireEvent.change(owedPeople(), { target: { value: '4' } });
    fireEvent.click(submit());
    const added = dispatched('ADD_TRANSACTION');
    if (!added || added.type !== 'ADD_TRANSACTION') throw new Error('unreachable: nothing was added');
    expect(added.payload.owed).toMatchObject({ amount: 75, people: 4 });
  });
});

describe('submission', () => {
  it('dispatches the parsed transaction and learns the merchant', () => {
    renderEntry();
    fireEvent.change(amount(), { target: { value: '42.50' } });
    fireEvent.change(merchant(), { target: { value: 'Zyxo Mart' } });
    fireEvent.change(category(), { target: { value: 'groceries' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-20' } });
    fireEvent.change(tags(), { target: { value: 'rbc, one-time,' } });
    fireEvent.click(submit());

    const added = dispatched('ADD_TRANSACTION');
    if (!added || added.type !== 'ADD_TRANSACTION') throw new Error('unreachable: nothing was added');
    expect(added.payload).toMatchObject({
      date: '2026-09-20',
      merchant: 'Zyxo Mart',
      amount: 42.5,          // the input holds text until submit parses it
      category: 'groceries',
      kind: 'expense',
      goalId: '',
      tags: ['rbc', 'one-time'], // split, trimmed, and the trailing blank dropped
    });
    expect(added.payload.owed).toBeUndefined();

    // The correction is remembered so the next entry skips all three tiers.
    const learned = dispatched('UPDATE_SETTINGS');
    if (!learned || learned.type !== 'UPDATE_SETTINGS') throw new Error('unreachable: nothing was learned');
    expect(learned.payload.merchantCategoryHints).toEqual({ 'zyxo mart': 'groceries' });
  });

  it('gives a savings contribution its fixed category and a readable merchant', () => {
    renderEntry({ savings_goals: [makeGoal({ id: 'g1', name: 'Japan Trip' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Savings' }));
    fireEvent.change(amount(), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Contribute to Goal'), { target: { value: 'g1' } });
    fireEvent.click(submit());

    const added = dispatched('ADD_TRANSACTION');
    if (!added || added.type !== 'ADD_TRANSACTION') throw new Error('unreachable: nothing was added');
    expect(added.payload).toMatchObject({
      kind: 'savings',
      category: 'savings',
      merchant: 'Savings → Japan Trip',
      goalId: 'g1',
      amount: 250,
    });
    // Savings carry a synthetic merchant, so learning from it would poison the
    // hints with "savings → japan trip".
    expect(dispatched('UPDATE_SETTINGS')).toBeUndefined();
  });

  it('updates rather than adds when editing', () => {
    renderEntry({}, { editTransaction: makeTransaction({ id: 'tx_1', merchant: 'Zyxo Mart', amount: 10 }) });
    fireEvent.change(amount(), { target: { value: '12' } });
    fireEvent.click(submit('Save Changes'));
    const updated = dispatched('UPDATE_TRANSACTION');
    if (!updated || updated.type !== 'UPDATE_TRANSACTION') throw new Error('unreachable: nothing was updated');
    expect(updated.payload).toMatchObject({ id: 'tx_1', amount: 12 });
    expect(dispatched('ADD_TRANSACTION')).toBeUndefined();
  });
});

// --- The modal shell --------------------------------------------------------

describe('as a modal', () => {
  it('is a labelled dialog that opens with the amount focused', () => {
    const onClose = vi.fn();
    renderEntry({}, { isModal: true, onClose });
    expect(screen.getByRole('dialog', { name: 'Add Transaction' })).toBeInTheDocument();
    // initialFocus points at the amount field: the one thing every entry needs.
    expect(amount()).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on escape', () => {
    const onClose = vi.fn();
    renderEntry({}, { isModal: true, onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
