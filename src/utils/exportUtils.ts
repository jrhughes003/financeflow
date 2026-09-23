import { format } from 'date-fns';
import type { IsoDate, Money, Transaction } from '../types/domain';
import type { AppState } from '../types/state';
import { asAppState, looksLikeAppState } from '../types/state';
import { autoCategorize } from './categorization';

// Download any string as a file
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Export transactions to CSV
export function exportToCSV(transactions: Transaction[], filename = 'transactions.csv'): void {
  const headers = ['Date', 'Merchant', 'Category', 'Subcategory', 'Amount', 'Tags', 'Notes', 'Exception'];
  const rows = transactions.map(t => [
    t.date,
    `"${t.merchant.replace(/"/g, '""')}"`,
    t.category,
    t.subcategory || '',
    t.amount.toFixed(2),
    (t.tags || []).join(';'),
    `"${(t.notes || '').replace(/"/g, '""')}"`,
    t.isException ? 'yes' : 'no',
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadFile(csv, filename, 'text/csv;charset=utf-8;');
}

// Export full data backup as JSON
export function exportToJSON(data: AppState, filename = 'financeflow_backup.json'): void {
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, filename, 'application/json');
}

// The collections we expect in a full backup. customCategories/settings are
// optional for backwards-compatibility with older exports.
const BACKUP_COLLECTIONS = [
  'transactions', 'budgets', 'incomes', 'savings_goals',
  'investments', 'debts', 'recurringTemplates',
];

/**
 * Import a full data backup previously produced by exportToJSON.
 * Resolves with a normalized state object suitable for the LOAD_DATA action;
 * rejects if the file isn't valid JSON or doesn't look like a FinanceFlow backup.
 * This is the reliable cross-environment restore path (e.g. browser → desktop).
 */
export function importFromJSON(file: File): Promise<AppState> {
  return new Promise<AppState>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // Deliberately `unknown`: this is a file the user chose, and claiming
        // it is AppState here would propagate a guarantee nothing established
        // into every consumer downstream.
        const parsed: unknown = JSON.parse(String(e.target?.result ?? ''));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('Not a valid FinanceFlow backup file.'));
          return;
        }
        if (!looksLikeAppState(parsed)) {
          reject(new Error('This JSON does not contain FinanceFlow data.'));
          return;
        }
        // asAppState fills in every collection, so a backup written before a
        // later version added one still loads.
        resolve(asAppState(parsed));
      } catch {
        reject(new Error('Could not parse JSON file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

// ---------------------------------------------------------------------------
// CSV import — handles the following real-world formats:
//
//   Comma-separated OR tab-separated (auto-detected)
//   Quoted fields that contain commas: "Uber Eats, etc."
//   Windows line-endings (\r\n)
//   BOM character at start of file
//   Amount formats: -$8.00 / ($8.00) / -8.00 / 8.00  (negatives treated as expenses)
//   Date formats:  DD/MM/YYYY  MM/DD/YYYY  YYYY-MM-DD
//   Category column: maps your spreadsheet names → app category ids
// ---------------------------------------------------------------------------

// Map common spreadsheet category names to app category ids
const CATEGORY_MAP: Record<string, string> = {
  'dining out':    'dining_out',
  'dining':        'dining_out',
  'food':          'dining_out',
  'restaurants':   'dining_out',
  'groceries':     'groceries',
  'grocery':       'groceries',
  'gas':           'transportation',
  'transportation':'transportation',
  'transport':     'transportation',
  'parking':       'transportation',
  'subscription':  'subscriptions',
  'subscriptions': 'subscriptions',
  'products':      'products',
  'shopping':      'products',
  'misc':          'products',
  'other':         'products',
};

function mapCategory(raw: string | undefined): string | null {
  if (!raw) return null;
  return CATEGORY_MAP[raw.toLowerCase().trim()] ?? null;
}

// Parse a single CSV/TSV row, respecting quoted fields
function parseRow(line: string, delimiter: string): string[] {
  const cols = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
      else inQuote = !inQuote;
    } else if (ch === delimiter && !inQuote) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

// Parse DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD → YYYY-MM-DD string
function parseDate(raw: string | undefined): IsoDate {
  if (!raw) return format(new Date(), 'yyyy-MM-dd');
  const s = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY or MM/DD/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const [, a, b, year] = slash;
    // If first number > 12 it must be a day (DD/MM/YYYY)
    if (parseInt(a) > 12) return `${year}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
    // Otherwise assume DD/MM/YYYY (your spreadsheet format)
    return `${year}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
  }

  // Fallback
  return format(new Date(), 'yyyy-MM-dd');
}

// Parse amount strings like -$8.00 / ($8.00) / -8.00 / 8.00
// Returns a positive number (all imports treated as expenses unless explicitly positive)
function parseAmount(raw: string | undefined): Money {
  if (!raw) return 0;
  const s = raw.toString().trim();
  // Parentheses = negative: (8.00)
  const negative = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  const cleaned = s.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned) || 0;
  return negative ? val : val; // we always want the absolute value for expenses
}

export function importFromCSV(file: File): Promise<Transaction[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // Strip BOM, normalise line endings
        // readAsText always yields a string, but the FileReader type allows
        // an ArrayBuffer because readAsArrayBuffer shares the same result field.
        const text = String(e.target?.result ?? '')
          .replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = text.trim().split('\n').filter((l: string) => l.trim() !== '');
        if (lines.length < 2) { resolve([]); return; }

        // Auto-detect delimiter: tab or comma
        const firstLine = lines[0];
        const delimiter = firstLine.includes('\t') ? '\t' : ',';

        // Parse header to find column indices
        const headers = parseRow(firstLine, delimiter).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

        const idx = (keywords: string[]): number =>
          headers.findIndex(h => keywords.some(k => h.includes(k)));
        const dateIdx    = idx(['date']);
        const descIdx    = idx(['description','desc','merchant','name','payee','details']);
        const amtIdx     = idx(['amount','debit','credit','sum','total','value']);
        const catIdx     = idx(['category','cat','type','label']);
        const accountIdx = idx(['account','method','card','bank']);

        if (amtIdx === -1 || descIdx === -1) {
          reject(new Error('Could not find required columns (Description and Amount). See format guide below.'));
          return;
        }

        const transactions = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseRow(lines[i], delimiter);
          if (cols.every(c => !c)) continue; // skip blank rows

          const rawAmount = cols[amtIdx] ?? '';
          const amount = parseAmount(rawAmount);
          if (amount <= 0) continue; // skip zero-amount rows and credits/refunds

          const merchant = (cols[descIdx] || 'Unknown').replace(/\s+/g, ' ').trim();
          const rawDate  = dateIdx !== -1 ? cols[dateIdx] : '';
          const rawCat   = catIdx  !== -1 ? cols[catIdx]  : '';
          const account  = accountIdx !== -1 ? cols[accountIdx] : '';

          // Determine category: spreadsheet column → keyword map → auto-detect by merchant
          const category = mapCategory(rawCat) || autoCategorize(merchant);

          transactions.push({
            id: `import_${Date.now()}_${i}_${Math.random().toString(36).slice(2,6)}`,
            date: parseDate(rawDate),
            merchant,
            amount,
            category,
            subcategory: '',
            notes: account ? `Imported · ${account}` : 'Imported from CSV',
            tags: ['imported', ...(account ? [account.toLowerCase().replace(/\s+/g,'-')] : [])],
            isException: false,
          });
        }
        resolve(transactions);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}
