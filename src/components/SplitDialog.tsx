// Split one purchase across categories, or merge a split back into one.

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import Modal from './ui/Modal';
import { Button, IconButton, Money } from './ui';
import { useFinancial } from '../context/FinancialContext';
import { useToast } from '../context/ToastContext';
import { getAllCategories } from '../utils/categorization';
import { selectable } from '../utils/categoryTree';
import { applySplit, mergeSplit, splitGroup, validateSplit, type SplitPart } from '../utils/splits';
import { formatCurrency } from '../utils/calculations';
import type { Transaction } from '../types/domain';

const INPUT = 'h-7 px-2 bg-surface border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';

interface Draft { category: string; amount: string }

export default function SplitDialog({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const { state, dispatch } = useFinancial();
  const { toast } = useToast();
  const group = useMemo(() => splitGroup(transaction, state.transactions), [transaction, state.transactions]);
  const isSplit = group.length > 1;
  const total = group.reduce((s, t) => s + Math.round(t.amount * 100), 0) / 100;
  const categories = useMemo(() => selectable(getAllCategories(state.customCategories || [])), [state.customCategories]);
  const blocked = group.some(t => t.owed) || group.some(t => t.kind === 'savings');

  const [drafts, setDrafts] = useState<Draft[]>(() => (isSplit
    ? group.map(t => ({ category: t.category, amount: String(t.amount) }))
    : [{ category: transaction.category, amount: String(transaction.amount) }, { category: '', amount: '' }]));
  const [error, setError] = useState<string | null>(null);

  const parts: SplitPart[] = drafts.map(d => ({ category: d.category, amount: parseFloat(d.amount) || 0 }));
  const allocated = parts.reduce((s, p) => s + Math.round(p.amount * 100), 0) / 100;
  const remaining = Math.round((total - allocated) * 100) / 100;

  const setDraft = (i: number, patch: Partial<Draft>) => setDrafts(list => list.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  // The first part absorbs whatever is left, so typing the smaller parts is enough.
  const balanceFirst = () => setDraft(0, { amount: String(Math.round(((parseFloat(drafts[0].amount) || 0) + remaining) * 100) / 100) });

  const replaceGroup = (next: Transaction[], message: string) => {
    const before = group;
    dispatch({ type: 'DELETE_TRANSACTIONS', payload: before.map(t => t.id) });
    dispatch({ type: 'IMPORT_TRANSACTIONS', payload: next });
    toast(message, {
      type: 'neutral',
      action: {
        label: 'Undo',
        onClick: () => {
          dispatch({ type: 'DELETE_TRANSACTIONS', payload: next.map(t => t.id) });
          dispatch({ type: 'IMPORT_TRANSACTIONS', payload: before });
        },
      },
    });
    onClose();
  };

  const save = () => {
    const problem = validateSplit(total, parts);
    if (problem) { setError(problem); return; }
    const base = mergeSplit(group);
    replaceGroup(applySplit(base, parts, group[0].splitGroupId), `Split ${transaction.merchant} into ${parts.length} parts`);
  };

  const merge = () => replaceGroup([mergeSplit(group)], `Merged ${transaction.merchant} back into one`);

  return (
    <Modal label="Split transaction" onClose={onClose} className="w-full sm:max-w-lg">
      <div className="bg-surface w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 h-bar flex items-center justify-between gap-2 pl-2.5 pr-0.5 bg-surface-sunk border-b border-line">
          <h2 className="text-micro uppercase font-semibold text-ink truncate">Split · {transaction.merchant} · {formatCurrency(total)}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="p-3 space-y-2">
          {blocked ? (
            <p className="font-sans text-sm text-ink-secondary">
              Purchases fronted for other people, and savings contributions, can&apos;t be split: their repayments and goal progress are tied to the whole amount.
            </p>
          ) : (
            <>
              <p className="font-sans text-caption text-ink-secondary">
                Each part becomes its own line in the ledger and counts toward its own budget. Together they still match the one charge on your statement.
              </p>
              {drafts.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select value={d.category} onChange={e => setDraft(i, { category: e.target.value })} className={`${INPUT} flex-1 min-w-0`} aria-label={`Category for part ${i + 1}`}>
                    <option value="">Category…</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input
                    type="number" step="0.01" min="0" value={d.amount}
                    onChange={e => setDraft(i, { amount: e.target.value })}
                    placeholder="0.00" aria-label={`Amount for part ${i + 1}`}
                    className={`${INPUT} w-28 text-right`}
                  />
                  <IconButton icon={Trash2} label={`Remove part ${i + 1}`} disabled={drafts.length <= 2} onClick={() => setDrafts(list => list.filter((_, j) => j !== i))} />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" icon={Plus} onClick={() => setDrafts(list => [...list, { category: '', amount: '' }])}>Add part</Button>
                <span className={`text-caption ${remaining === 0 ? 'text-positive' : 'text-caution'}`}>
                  {remaining === 0 ? 'Adds up to the charge.' : <>Left to assign: <Money value={remaining} size="caption" /></>}
                </span>
                {remaining !== 0 && <Button size="sm" variant="ghost" onClick={balanceFirst}>Put the rest in part 1</Button>}
              </div>
              {error && <p className="font-sans text-caption text-negative">{error}</p>}
            </>
          )}
          <div className="flex gap-1.5 pt-1">
            {isSplit && !blocked && <Button onClick={merge}>Merge back into one</Button>}
            <span className="flex-1" />
            <Button onClick={onClose}>Cancel</Button>
            {!blocked && <Button variant="primary" onClick={save}>Save split</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
