import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { format } from 'date-fns';
import { exportToCSV, exportToJSON, importFromCSV, importFromJSON } from './exportUtils';
import { makeState, makeTransaction } from '../test/factories';
import type { Transaction } from '../types/domain';

// CSV import is the documented migration route into the app, and a parser that
// quietly mangles a ledger is worse than one that refuses it. These tests pin
// what the parser actually does — including the places where that is not what
// the header comment on exportUtils.ts:86-95 promises. Those disagreements are
// called out at the case that proves them rather than fixed here.

const csvFile = (text: string) => new File([text], 'ledger.csv', { type: 'text/csv' });
const jsonFile = (text: string) => new File([text], 'backup.json', { type: 'application/json' });

// The fields a test actually cares about; the generated id is random and the
// timestamp inside it would make every toEqual a moving target.
const shape = (t: Transaction) => ({ date: t.date, merchant: t.merchant, amount: t.amount, category: t.category });

// jsdom's Blob has no .text(), so read it back the same way the importers do.
const readBlob = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(new Error('could not read blob'));
  reader.readAsText(blob);
});

const today = format(new Date(), 'yyyy-MM-dd');

describe('importFromCSV — file shape', () => {
  it('strips a BOM instead of corrupting the first header', async () => {
    // A file saved by Excel starts with a BOM. If it survives, the first
    // column header stops matching and the Date column silently disappears.
    const rows = await importFromCSV(csvFile('﻿Date,Description,Amount\n2026-02-03,Metro,12.00\n'));
    expect(rows.map(shape)).toEqual([{ date: '2026-02-03', merchant: 'Metro', amount: 12, category: 'groceries' }]);
  });

  it('parses CRLF and LF identically', async () => {
    const body = 'Date,Description,Amount\n2026-02-03,Metro,12.00\n2026-02-04,Netflix,8.00\n';
    const lf = await importFromCSV(csvFile(body));
    const crlf = await importFromCSV(csvFile(body.replace(/\n/g, '\r\n')));
    expect(crlf.map(shape)).toEqual(lf.map(shape));
    expect(lf).toHaveLength(2);
  });

  it('keeps a quoted field containing commas as one field, and unescapes doubled quotes', async () => {
    const rows = await importFromCSV(csvFile('Date,Description,Amount\n2026-02-03,"Uber Eats, etc.",8.00\n2026-02-04,"Say ""Hi"", Bob",9.00\n'));
    expect(rows.map(t => t.merchant)).toEqual(['Uber Eats, etc.', 'Say "Hi", Bob']);
    expect(rows.map(t => t.amount)).toEqual([8, 9]);
  });

  it('auto-detects a tab-separated export', async () => {
    const rows = await importFromCSV(csvFile('Transaction Date\tPayee\tAmount\n2026-02-03\tTim Hortons\t4.00\n'));
    expect(rows.map(shape)).toEqual([{ date: '2026-02-03', merchant: 'Tim Hortons', amount: 4, category: 'dining_out' }]);
  });

  it('skips blank, whitespace-only and empty-field lines rather than importing them', async () => {
    const rows = await importFromCSV(csvFile('Date,Description,Amount\n\n   \n2026-02-03,  Metro   Plus  ,12.00\n,,\n   \n'));
    expect(rows).toHaveLength(1);
    // Runs of whitespace inside the merchant collapse too.
    expect(rows[0].merchant).toBe('Metro Plus');
  });

  it('resolves empty for a file with no data rows', async () => {
    expect(await importFromCSV(csvFile('Date,Description,Amount\n'))).toEqual([]);
    expect(await importFromCSV(csvFile(''))).toEqual([]);
  });

  it('rejects a file with no recognisable Description or Amount column', async () => {
    // The one loud failure in the parser: without these two there is nothing
    // to import, so it refuses rather than producing a file of 'Unknown' rows.
    await expect(importFromCSV(csvFile('Foo,Bar\n1,2\n'))).rejects.toThrow(/required columns/);
    await expect(importFromCSV(csvFile('Date,Description\n2026-02-03,Metro\n'))).rejects.toThrow(/required columns/);
  });
});

describe('importFromCSV — amounts', () => {
  const amounts = async (...cells: string[]) => {
    const rows = await importFromCSV(csvFile(
      ['Date,Description,Amount', ...cells.map((c, i) => `2026-02-0${i + 1},M${i},${c}`)].join('\n'),
    ));
    return rows.map(t => t.amount);
  };

  it('reads every documented amount format as a POSITIVE expense', async () => {
    // parseAmount (exportUtils.ts:167-175) computes `negative` and then returns
    // `negative ? val : val` — both branches are the same value, so the sign is
    // discarded. -$8.00, ($8.00) and 8.00 are therefore indistinguishable.
    expect(await amounts('-$8.00', '($8.00)', '-8.00', '8.00')).toEqual([8, 8, 8, 8]);
  });

  it('strips currency symbols and thousands separators', async () => {
    // The thousands separator only survives inside quotes — unquoted it is the
    // delimiter, and the row silently shifts a column.
    expect(await amounts('"$1,234.56"', 'CAD 42', '  9.99  ')).toEqual([1234.56, 42, 9.99]);
  });

  it('skips rows whose amount is zero, blank or unparseable', async () => {
    // The `amount <= 0` guard at exportUtils.ts:217 is commented as skipping
    // "credits/refunds", but since parseAmount never returns a negative the
    // only rows it can ever skip are these. A -$50 refund is imported as a
    // +$50 expense (see the sign case above) — the guard cannot see it.
    expect(await amounts('0.00', '', 'n/a', '5.00')).toEqual([5]);
  });
});

describe('importFromCSV — dates', () => {
  const dateOf = async (cell: string) => {
    const rows = await importFromCSV(csvFile(`Date,Description,Amount\n${cell},Metro,1.00\n`));
    if (rows.length !== 1) throw new Error('unreachable');
    return rows[0].date;
  };

  it('keeps an ISO date, truncating a timestamp to the day', async () => {
    expect(await dateOf('2026-02-03')).toBe('2026-02-03');
    expect(await dateOf('2026-02-03T14:30:00Z')).toBe('2026-02-03');
  });

  it('reads slash dates as DD/MM/YYYY', async () => {
    expect(await dateOf('03/05/2026')).toBe('2026-05-03');
    expect(await dateOf('25/12/2026')).toBe('2026-12-25');
  });

  it('reads a slash date as MM/DD when the second number cannot be a month', async () => {
    // Regression. Both branches of parseDate used to return the same DD/MM
    // expression, so MM/DD never worked despite being advertised, and a
    // US-format Christmas came out as "2026-25-12" — a 25th month, written
    // into Transaction.date where every comparison is a string compare.
    expect(await dateOf('12/25/2026')).toBe('2026-12-25');
    expect(await dateOf('07/31/2026')).toBe('2026-07-31');
  });

  it('never emits a month outside 1-12, whichever way the date is written', async () => {
    // The property that actually matters: ambiguity is allowed, impossibility
    // is not. Whatever parseDate decides, it has to be a real date.
    for (const raw of ['12/25/2026', '25/12/2026', '03/05/2026', '01/01/2026', '31/01/2026']) {
      const iso = await dateOf(raw);
      expect(Number.isNaN(new Date(iso).getTime()), `${raw} parsed to ${iso}`).toBe(false);
      const month = Number(iso.slice(5, 7));
      expect(month, `${raw} parsed to ${iso}`).toBeGreaterThanOrEqual(1);
      expect(month, `${raw} parsed to ${iso}`).toBeLessThanOrEqual(12);
    }
  });

  it('silently substitutes today for a date it cannot read, and for a missing Date column', async () => {
    // exportUtils.ts:162. A bank export with an unexpected date format imports
    // as a ledger where every row happened today, with nothing flagging it.
    expect(await dateOf('03-02-2026')).toBe(today); // DD-MM-YYYY, a common bank format
    expect(await dateOf('Feb 3 2026')).toBe(today);
    expect(await dateOf('')).toBe(today);
    const noDateColumn = await importFromCSV(csvFile('Description,Amount\nMetro,1.00\n'));
    expect(noDateColumn[0].date).toBe(today);
  });
});

describe('importFromCSV — columns', () => {
  it('finds columns by keyword in any order, and tags the account', async () => {
    const rows = await importFromCSV(csvFile('Amount,Payee,Transaction Date,Account\n-$4.00,Tim Hortons,2026-02-03,Visa Gold\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-02-03', merchant: 'Tim Hortons', amount: 4,
      notes: 'Imported · Visa Gold', tags: ['imported', 'visa-gold'],
    });
  });

  it('falls back to the plain defaults when the optional columns are missing', async () => {
    const rows = await importFromCSV(csvFile('Description,Amount\nMetro,12.00\n'));
    expect(rows[0]).toMatchObject({
      notes: 'Imported from CSV', tags: ['imported'], subcategory: '', isException: false,
    });
    expect(rows[0].id).toMatch(/^import_/);
  });

  it('maps spreadsheet category names, and auto-categorizes by merchant when it cannot', async () => {
    const rows = await importFromCSV(csvFile([
      'Date,Description,Amount,Category',
      '2026-02-01,Zzz Unknown Co,1.00,Dining Out',   // a name CATEGORY_MAP knows
      '2026-02-02,Zzz Unknown Co,1.00,Hardware',     // a name it does not
      '2026-02-03,Netflix,1.00,',                    // no category → merchant keyword
      '2026-02-04,Zzz Unknown Co,1.00,',             // nothing matches → catch-all
    ].join('\n')));
    expect(rows.map(t => t.category)).toEqual(['dining_out', 'products', 'subscriptions', 'products']);
  });

  it('accepts a Type column as the category column', async () => {
    const rows = await importFromCSV(csvFile('Date,Merchant,Amount,Type\n2026-02-03,Zzz Unknown Co,1.00,Groceries\n'));
    expect(rows[0].category).toBe('groceries');
  });

  it('silently drops a short row and ignores extra cells on a long one', async () => {
    // A row missing its amount cell reads as 0 and is skipped by the `amount
    // <= 0` guard — no error, no count, nothing telling the user a line of
    // their ledger did not arrive. Extra trailing cells are simply ignored.
    const rows = await importFromCSV(csvFile([
      'Date,Description,Amount',
      '2026-02-01,Short Row',
      '2026-02-02,Long Row,7.00,junk,more junk',
      '2026-02-03,Fine,1.00',
    ].join('\n')));
    expect(rows.map(shape)).toEqual([
      { date: '2026-02-02', merchant: 'Long Row', amount: 7, category: 'products' },
      { date: '2026-02-03', merchant: 'Fine', amount: 1, category: 'products' },
    ]);
  });

  it('names a row with an empty description "Unknown" rather than dropping it', async () => {
    const rows = await importFromCSV(csvFile('Date,Description,Amount\n2026-02-03,,5.00\n'));
    expect(rows.map(t => t.merchant)).toEqual(['Unknown']);
  });
});

describe('importFromJSON', () => {
  it('restores a backup produced by exportToJSON', async () => {
    const state = makeState({ transactions: [makeTransaction({ id: 'a', amount: 42 })] });
    const restored = await importFromJSON(jsonFile(JSON.stringify(state)));
    expect(restored).toEqual(state);
  });

  it('fills in collections a backup from an older version never had', async () => {
    // asAppState is deliberately forgiving here: one known collection is
    // enough, and the rest come back as empty arrays rather than undefined.
    const restored = await importFromJSON(jsonFile(JSON.stringify({ transactions: [makeTransaction({ id: 'a' })] })));
    expect(restored).toEqual(makeState({ transactions: [makeTransaction({ id: 'a' })], settings: {} }));
  });

  it('rejects a file that is not a FinanceFlow backup — this is a trust boundary', async () => {
    // Nothing downstream re-checks this, so the validation at exportUtils.ts
    // :65-72 is the only thing between an arbitrary chosen file and LOAD_DATA.
    await expect(importFromJSON(jsonFile('{"foo":1}'))).rejects.toThrow('This JSON does not contain FinanceFlow data.');
    // A collection key present but not an array fails the same way.
    await expect(importFromJSON(jsonFile('{"transactions":{"0":{"id":"a"}}}'))).rejects.toThrow('This JSON does not contain FinanceFlow data.');
    await expect(importFromJSON(jsonFile('[{"transactions":[]}]'))).rejects.toThrow('Not a valid FinanceFlow backup file.');
    await expect(importFromJSON(jsonFile('42'))).rejects.toThrow('Not a valid FinanceFlow backup file.');
    await expect(importFromJSON(jsonFile('null'))).rejects.toThrow('Not a valid FinanceFlow backup file.');
    await expect(importFromJSON(jsonFile('not json at all'))).rejects.toThrow('Could not parse JSON file.');
  });
});

describe('exportToCSV / exportToJSON', () => {
  interface Download { blob: Blob; filename: string; attachedWhenClicked: boolean }
  let downloads: Download[] = [];
  let revoked: string[] = [];
  let blobForUrl: Blob | null = null;

  const urlStub = URL as unknown as {
    createObjectURL?: (b: Blob) => string;
    revokeObjectURL?: (u: string) => void;
  };

  beforeEach(() => {
    downloads = [];
    revoked = [];
    blobForUrl = null;
    // jsdom implements neither object-URL method, so downloadFile cannot run
    // without stand-ins; capturing the Blob is also how these tests read back
    // what was written.
    urlStub.createObjectURL = (blob: Blob) => { blobForUrl = blob; return 'blob:financeflow-test'; };
    urlStub.revokeObjectURL = (url: string) => { revoked.push(url); };
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (!blobForUrl) throw new Error('unreachable');
      downloads.push({ blob: blobForUrl, filename: this.download, attachedWhenClicked: document.body.contains(this) });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete urlStub.createObjectURL;
    delete urlStub.revokeObjectURL;
  });

  const onlyDownload = (): Download => {
    if (downloads.length !== 1) throw new Error(`expected one download, got ${downloads.length}`);
    return downloads[0];
  };

  it('writes the header row, two-decimal amounts, and quotes a merchant containing a comma', async () => {
    exportToCSV([
      makeTransaction({
        date: '2026-02-03', merchant: 'Uber Eats, etc.', category: 'dining_out', subcategory: 'Takeout',
        amount: 8.5, tags: ['imported', 'lunch'], notes: 'he said "hi"', isException: true,
      }),
      makeTransaction({ date: '2026-02-04', merchant: 'Metro', category: 'groceries', amount: 12 }),
    ]);
    const csv = await readBlob(onlyDownload().blob);
    expect(csv.split('\n')).toEqual([
      'Date,Merchant,Category,Subcategory,Amount,Tags,Notes,Exception',
      '2026-02-03,"Uber Eats, etc.",dining_out,Takeout,8.50,imported;lunch,"he said ""hi""",yes',
      // A transaction with no subcategory, tags or notes still writes every column.
      '2026-02-04,"Metro",groceries,,12.00,,"",no',
    ]);
  });

  it('downloads through an anchor that is in the document when clicked, then revokes the url', async () => {
    exportToCSV([makeTransaction()], 'my-ledger.csv');
    const download = onlyDownload();
    expect(download.filename).toBe('my-ledger.csv');
    expect(download.attachedWhenClicked).toBe(true);
    expect(download.blob.type).toBe('text/csv;charset=utf-8;');
    expect(revoked).toEqual(['blob:financeflow-test']);
    expect(document.body.children).toHaveLength(0); // and cleaned up afterwards
    exportToCSV([]);
    expect(downloads[1].filename).toBe('transactions.csv'); // default name
  });

  it('writes the whole state as JSON that importFromJSON accepts', async () => {
    const state = makeState({ transactions: [makeTransaction({ id: 'a', amount: 42 })] });
    exportToJSON(state);
    const download = onlyDownload();
    expect(download.filename).toBe('financeflow_backup.json');
    expect(download.blob.type).toBe('application/json');
    const json = await readBlob(download.blob);
    expect(json).toContain('\n  "transactions"'); // pretty-printed, so a backup is readable
    expect(await importFromJSON(jsonFile(json))).toEqual(state);
  });

  it('round-trips date, merchant and amount through CSV — but loses everything else', async () => {
    // The honest scope of the CSV route. Only three fields survive re-import,
    // and the Category column survives only when the app's own id happens to
    // be a key in CATEGORY_MAP (exportUtils.ts:98-115): 'groceries' is, and
    // 'dining_out' is not, so a restaurant charge comes back as 'products'
    // unless the merchant name happens to match a keyword.
    const original = [
      makeTransaction({
        id: 'a', date: '2026-02-03', merchant: 'Zzz Kelsey Hardware, Inc.', category: 'dining_out',
        subcategory: 'Restaurant', amount: 43.75, tags: ['dinner'], notes: 'with Ana', isException: true,
      }),
      makeTransaction({ id: 'b', date: '2026-02-04', merchant: 'Metro', category: 'groceries', amount: 12 }),
    ];
    exportToCSV(original);
    const reimported = await importFromCSV(csvFile(await readBlob(onlyDownload().blob)));

    expect(reimported.map(t => ({ date: t.date, merchant: t.merchant, amount: t.amount })))
      .toEqual(original.map(t => ({ date: t.date, merchant: t.merchant, amount: t.amount })));
    expect(reimported.map(t => t.category)).toEqual(['products', 'groceries']);
    expect(reimported.map(t => t.subcategory)).toEqual(['', '']);
    expect(reimported.map(t => t.notes)).toEqual(['Imported from CSV', 'Imported from CSV']);
    expect(reimported.map(t => t.isException)).toEqual([false, false]);
    expect(reimported.map(t => t.id)).not.toEqual(['a', 'b']); // ids are regenerated
  });

  it('drops a zero-amount transaction on re-import', async () => {
    // Worth knowing before calling CSV a backup format: a $0 row (a fully
    // refunded charge, a placeholder) exports fine and never comes back.
    exportToCSV([makeTransaction({ id: 'a', merchant: 'Refunded', amount: 0 })]);
    expect(await importFromCSV(csvFile(await readBlob(onlyDownload().blob)))).toEqual([]);
  });
});
