// The step between choosing a CSV and it landing in the ledger.
//
// Importing used to be one-way: every row went straight in, so a statement
// that overlapped one already imported doubled those weeks without a word.
// Here each row is shown first, rows the ledger already has arrive unticked
// with the match beside them, and the category can be fixed before anything is
// saved rather than one row at a time afterwards.

import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { X } from 'lucide-react';
import Modal from './ui/Modal';
import { Button, IconButton, Money, Badge } from './ui';
import { findDuplicates } from '../utils/importDedupe';
import { foldSplits } from '../utils/splits';
import { getAllCategories } from '../utils/categorization';
import { selectable } from '../utils/categoryTree';
import type { Category, Transaction } from '../types/domain';

interface Props {
  fileName: string;
  rows: Transaction[];
  existing: Transaction[];
  customCategories: Category[];
  onConfirm: (rows: Transaction[]) => void;
  onClose: () => void;
}

const TH = 'label-micro font-medium h-[22px] py-0 px-2 border-b border-line bg-surface-sunk whitespace-nowrap text-left';
const TD = 'h-row py-0 px-2 border-b border-line align-middle';

const fmtDate = (d: string): string => {
  try { return format(parseISO(d), 'dd MMM yyyy').toUpperCase(); } catch { return d; }
};

export default function ImportPreview({ fileName, rows, existing, customCategories, onConfirm, onClose }: Props) {
  // A split purchase is several ledger rows but one bank charge, so the ledger
  // is compared with its splits folded back together.
  const matches = useMemo(() => findDuplicates(rows, foldSplits(existing)), [rows, existing]);
  const [included, setIncluded] = useState<boolean[]>(() => matches.map(m => !m));
  const [categories, setCategories] = useState<string[]>(() => rows.map(r => r.category));
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const options = useMemo(() => selectable(getAllCategories(customCategories)), [customCategories]);

  const duplicateCount = matches.filter(Boolean).length;
  const chosen = included.filter(Boolean).length;
  const chosenTotal = rows.reduce((s, r, i) => s + (included[i] ? r.amount : 0), 0);

  const toggle = (i: number) => setIncluded(list => list.map((v, j) => (j === i ? !v : v)));
  const setAll = (value: boolean) => setIncluded(rows.map(() => value));

  const confirm = () => onConfirm(rows
    .map((r, i) => ({ ...r, category: categories[i] }))
    .filter((_r, i) => included[i]));

  const visible = rows.map((r, i) => ({ r, i })).filter(({ i }) => !onlyDuplicates || matches[i]);

  return (
    <Modal label="Review import" onClose={onClose} className="w-full sm:max-w-4xl">
      <div className="bg-surface w-full max-h-[90vh] flex flex-col">
        <div className="h-bar shrink-0 flex items-center justify-between gap-2 pl-2.5 pr-0.5 bg-surface-sunk border-b border-line">
          <h2 className="text-micro uppercase font-semibold text-ink truncate">Review import · {fileName}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>

        <div className="shrink-0 px-3 py-2 border-b border-line font-sans text-sm text-ink-secondary space-y-1">
          <p>
            <span className="text-ink font-medium">{rows.length}</span> rows read.{' '}
            {duplicateCount > 0
              ? <><span className="text-caution font-medium">{duplicateCount}</span> look like transactions you already have and are unticked.</>
              : 'None of them match anything already in your ledger.'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => setAll(true)}>Tick all</Button>
            <Button size="sm" onClick={() => setAll(false)}>Untick all</Button>
            <Button size="sm" onClick={() => setIncluded(matches.map(m => !m))}>Untick duplicates only</Button>
            {duplicateCount > 0 && (
              <label className="ml-auto inline-flex items-center gap-1.5 text-caption">
                <input type="checkbox" checked={onlyDuplicates} onChange={e => setOnlyDuplicates(e.target.checked)} />
                Show only possible duplicates
              </label>
            )}
          </div>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr>
                <th className={`${TH} w-8`}><span className="sr-only">Import</span></th>
                <th className={TH}>Date</th>
                <th className={TH}>Merchant</th>
                <th className={TH}>Category</th>
                <th className={`${TH} text-right`}>Amount</th>
                <th className={TH}>Already in ledger?</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ r, i }) => {
                const m = matches[i];
                return (
                  <tr key={r.id} className={included[i] ? '' : 'opacity-60'}>
                    <td className={TD}>
                      <input type="checkbox" checked={included[i]} onChange={() => toggle(i)} aria-label={`Import ${r.merchant} on ${r.date}`} />
                    </td>
                    <td className={`${TD} whitespace-nowrap text-caption text-ink-secondary`}>{fmtDate(r.date)}</td>
                    <td className={`${TD} max-w-[16rem] truncate text-ink`} title={r.merchant}>{r.merchant}</td>
                    <td className={TD}>
                      <select
                        value={categories[i]}
                        onChange={e => setCategories(list => list.map((c, j) => (j === i ? e.target.value : c)))}
                        className="h-6 px-1 bg-surface border border-line-strong rounded-control text-caption text-ink max-w-[11rem]"
                        aria-label={`Category for ${r.merchant}`}
                      >
                        {!options.some(o => o.id === categories[i]) && <option value={categories[i]}>{categories[i]}</option>}
                        {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap`}><Money value={-r.amount} size="sm" /></td>
                    <td className={`${TD} text-caption`}>
                      {m ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <Badge tone={m.strength === 'exact' ? 'negative' : 'caution'}>{m.strength === 'exact' ? 'Duplicate' : 'Likely'}</Badge>
                          <span className="text-ink-secondary truncate max-w-[12rem]" title={m.existing.merchant}>
                            {fmtDate(m.existing.date)} · {m.existing.merchant}
                          </span>
                        </span>
                      ) : <span className="text-ink-muted">New</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-t border-line bg-surface-sunk">
          <span className="text-caption text-ink-secondary">
            {chosen} of {rows.length} selected · <Money value={chosenTotal} size="caption" className="text-ink" />
          </span>
          <div className="flex gap-1.5">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={confirm} disabled={chosen === 0}>Import {chosen}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
