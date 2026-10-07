import React, { useEffect, useState, useRef } from 'react';
import { Download, Upload, Trash2, KeyRound, Wand2 } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { aiSupported, getAiStatus, setAiKey, clearAiKey } from '../ai/ai';
import { exportToJSON, importFromJSON } from '../utils/exportUtils';
import generateDemoData from '../utils/demoData';
import AiAuditPanel from './AiAuditPanel';
import CategoryGrouping from './CategoryGrouping';
import { Panel, Button, Badge } from './ui';
import { SUPPORTED_CURRENCIES, formatCurrency } from '../utils/calculations';
import { resolveTheme, DEFAULT_THEME } from '../utils/theme';
import type { ThemePreference } from '../types/state';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export default function Settings() {
  const { state, dispatch } = useFinancial();
  const settings = state.settings || {};
  const [status, setStatus] = useState({ encryptionAvailable: false, hasKey: false });
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { getAiStatus().then(setStatus); }, []);

  const aiEnabled = Boolean(settings.aiEnabled);

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    setBusy(true);
    const res = await setAiKey(keyInput.trim());
    setBusy(false);
    if (res.ok) {
      setKeyInput('');
      setStatus(await getAiStatus());
      setMsg({ type: 'ok', text: 'API key saved securely.' });
    } else {
      setMsg({ type: 'err', text: res.error === 'unavailable' ? 'AI requires the desktop app.' : res.error });
    }
  };

  const removeKey = async () => {
    await clearAiKey();
    dispatch({ type: 'UPDATE_SETTINGS', payload: { aiEnabled: false } });
    setStatus(await getAiStatus());
    setMsg({ type: 'ok', text: 'API key removed. AI features disabled.' });
  };

  const toggleAi = (on: boolean) => dispatch({ type: 'UPDATE_SETTINGS', payload: { aiEnabled: on } });

  // Replaces everything with generated sample data — handy for trying the app out
  // (and for taking screenshots without exposing real finances).
  const loadDemoData = () => {
    const hasData = (state.transactions || []).length > 0;
    const warning = hasData
      ? 'Replace ALL current data with generated demo data? This cannot be undone — export a backup first if you want to keep it.'
      : 'Load generated demo data so you can explore the app?';
    if (!window.confirm(warning)) return;
    dispatch({ type: 'LOAD_DATA', payload: generateDemoData(new Date()) });
    setMsg({ type: 'ok', text: 'Demo data loaded — about 8 months of sample history.' });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importFromJSON(file)
      .then(data => { dispatch({ type: 'LOAD_DATA', payload: data }); setMsg({ type: 'ok', text: 'Backup restored.' }); })
      .catch(err => setMsg({ type: 'err', text: err.message }))
      .finally(() => { if (fileRef.current) fileRef.current.value = ''; });
  };

  const theme = settings.theme ?? DEFAULT_THEME;
  const inputClass = 'w-full h-7 px-2 bg-canvas border border-line-strong rounded-control text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-accent';

  return (
    <div className="space-y-2 animate-fade-in max-w-3xl">
      {msg && (
        <div className="flex items-start gap-2.5 px-2.5 py-1.5 bg-surface border border-line">
          <Badge tone={msg.type === 'ok' ? 'positive' : 'negative'} className="shrink-0 mt-px">{msg.type === 'ok' ? 'OK' : 'ERR'}</Badge>
          <span className={`font-sans text-sm ${msg.type === 'ok' ? 'text-ink' : 'text-negative'}`}>{msg.text}</span>
        </div>
      )}

      {/* AI features */}
      <Panel
        bordered
        title="AI Features"
        meta={aiSupported ? (status.hasKey ? (aiEnabled ? 'KEY SAVED · ON' : 'KEY SAVED · OFF') : 'NO KEY') : 'DESKTOP ONLY'}
      >
        <p className="font-sans text-sm text-ink-muted px-2.5 py-2 border-b border-line">
          Optional. Uses your own Anthropic API key for smart categorization, natural-language
          entry, insights, and receipt parsing. Off by default.
        </p>

        {!aiSupported ? (
          <div className="flex items-start gap-2.5 px-2.5 py-1.5">
            <Badge className="shrink-0 mt-px">Web</Badge>
            <span className="font-sans text-sm text-ink-muted">
              AI features require the desktop app (they keep your key in OS-secured storage). The web
              version stays fully local with no AI.
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2.5 px-2.5 py-1.5 border-b border-line">
              <Badge tone="accent" className="shrink-0 mt-px">Privacy</Badge>
              <span className="font-sans text-sm text-ink-secondary">
                When enabled, only the minimum data per feature is sent to Anthropic (e.g. a merchant
                name, or aggregate totals — never your full transaction list). Everything else stays
                on your device. See the README for specifics.
              </span>
            </div>

            <div className="px-2.5 py-2 border-b border-line">
              <label htmlFor="settings-ai-key" className="label-micro block mb-1">Anthropic API Key</label>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <KeyRound className="w-3.5 h-3.5 text-ink-muted absolute left-2 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <input
                    id="settings-ai-key"
                    type="password"
                    value={keyInput}
                    onChange={e => setKeyInput(e.target.value)}
                    placeholder={status.hasKey ? '•••••••• (a key is saved)' : 'sk-ant-...'}
                    className={`${inputClass} pl-7`}
                  />
                </div>
                <Button variant="primary" onClick={saveKey} disabled={busy || !keyInput.trim()}>
                  {status.hasKey ? 'Replace' : 'Save'}
                </Button>
                {status.hasKey && (
                  <Button onClick={removeKey}>Remove</Button>
                )}
              </div>
              {!status.encryptionAvailable && (
                <p className="flex items-start gap-2 mt-1.5">
                  <Badge tone="caution" className="shrink-0 mt-px">Warn</Badge>
                  <span className="font-sans text-caption text-caution">OS secure storage unavailable — the key cannot be stored safely on this machine.</span>
                </p>
              )}
            </div>

            <label className="flex items-center justify-between gap-2 h-row px-2.5">
              <span className="text-caption uppercase tracking-[0.03em] text-ink-secondary">Enable AI features</span>
              <button
                onClick={() => toggleAi(!aiEnabled)}
                disabled={!status.hasKey}
                className={`relative w-8 h-4 rounded-control border transition-colors disabled:opacity-40 ${aiEnabled ? 'bg-accent border-accent' : 'bg-canvas border-line-strong'}`}
                title={!status.hasKey ? 'Save an API key first' : ''}
              >
                <span className={`absolute top-px left-px w-3 h-3 transition-transform ${aiEnabled ? 'translate-x-4 bg-ink-inverse' : 'bg-ink-muted'}`} />
              </button>
            </label>
          </>
        )}
      </Panel>

      {/* The privacy claim, made checkable. Desktop only, because the browser
          build has no key and no path to the API — there is nothing to show. */}
      {aiSupported && <AiAuditPanel />}

      {/* Backup & restore */}
      <Panel bordered title="Backup & Restore" meta="JSON">
        <p className="font-sans text-sm text-ink-muted px-2.5 py-2">Export a full JSON backup, or restore one (also the way to move data from the web app into the desktop app).</p>
        <div className="flex gap-1.5 px-2.5 pb-2.5">
          <Button icon={Download} onClick={() => exportToJSON(state)}>Export backup</Button>
          <Button icon={Upload} onClick={() => fileRef.current?.click()}>Restore backup</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
        </div>
      </Panel>

      <CategoryGrouping />

      {/* Display */}
      <Panel bordered title="Display" meta={`${settings.currency || 'CAD'} · ${theme.toUpperCase()}`}>
        <div className="px-2.5 py-2 border-b border-line">
          <label htmlFor="settings-currency" className="label-micro block mb-1">
            Currency
          </label>
          <select
            id="settings-currency"
            value={settings.currency || 'CAD'}
            onChange={e => dispatch({ type: 'UPDATE_SETTINGS', payload: { currency: e.target.value } })}
            className={`${inputClass} sm:w-40`}
          >
            {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <p className="font-sans text-sm text-ink-muted mt-1.5">
            Changes how every figure is printed — for example {formatCurrency(1234.5)}. It does not
            convert anything: the amounts you entered stay exactly as they are.
          </p>
        </div>

        <fieldset className="px-2.5 py-2">
          <legend className="label-micro float-left w-full mb-1">Theme</legend>
          <div role="radiogroup" aria-label="Theme" className="clear-left inline-flex rounded-control border border-line-strong overflow-hidden">
            {THEME_OPTIONS.map(({ value, label }) => {
              const active = theme === value;
              return (
                <button
                  key={value}
                  role="radio"
                  aria-checked={active}
                  onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { theme: value } })}
                  className={`h-6 min-w-[64px] px-2.5 text-micro font-medium uppercase tracking-[0.06em] transition-colors border-r border-line-strong last:border-r-0
                    ${active ? 'bg-accent-tint text-accent-ink' : 'bg-surface text-ink-secondary hover:bg-surface-hover hover:text-ink'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="font-sans text-sm text-ink-muted mt-1.5">
            {theme === 'system'
              ? `Following your system, which is currently ${resolveTheme('system')}. It will change with it.`
              : 'Fixed, whatever your system is set to.'}
          </p>
        </fieldset>
      </Panel>

      {/* Demo data */}
      <Panel bordered title="Demo Data">
        <p className="font-sans text-sm text-ink-muted px-2.5 py-2">
          Fill the app with about 8 months of generated transactions, budgets, goals, debts and a
          Plan Ahead setup, so every chart and insight has something to show. Replaces your current data.
        </p>
        <div className="px-2.5 pb-2.5">
          <Button icon={Wand2} onClick={loadDemoData}>Load demo data</Button>
        </div>
      </Panel>

      {/* Danger zone */}
      <section aria-labelledby="settings-danger" className="bg-surface border border-negative">
        <div className="h-bar flex items-center px-2.5 bg-surface-sunk border-b border-negative">
          <h2 id="settings-danger" className="text-micro uppercase font-semibold text-negative">Danger Zone</h2>
        </div>
        <div className="p-2.5">
          <Button
            variant="danger"
            icon={Trash2}
            className="border-negative"
            onClick={() => { if (window.confirm('Reset all data to the sample defaults? This cannot be undone.')) dispatch({ type: 'RESET_DATA' }); }}
          >
            Reset all data
          </Button>
        </div>
      </section>
    </div>
  );
}
