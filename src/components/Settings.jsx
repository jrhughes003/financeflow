import React, { useEffect, useState, useRef } from 'react';
import { Sparkles, ShieldCheck, Download, Upload, Trash2, KeyRound, AlertTriangle, Wand2 } from 'lucide-react';
import { useFinancial } from '../context/FinancialContext';
import { aiSupported, getAiStatus, setAiKey, clearAiKey } from '../ai/ai';
import { exportToJSON, importFromJSON } from '../utils/exportUtils';
import generateDemoData from '../utils/demoData';

export default function Settings() {
  const { state, dispatch } = useFinancial();
  const settings = state.settings || {};
  const [status, setStatus] = useState({ encryptionAvailable: false, hasKey: false });
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

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

  const toggleAi = (on) => dispatch({ type: 'UPDATE_SETTINGS', payload: { aiEnabled: on } });

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

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importFromJSON(file)
      .then(data => { dispatch({ type: 'LOAD_DATA', payload: data }); setMsg({ type: 'ok', text: 'Backup restored.' }); })
      .catch(err => setMsg({ type: 'err', text: err.message }))
      .finally(() => { if (fileRef.current) fileRef.current.value = ''; });
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-2xl">
      {msg && (
        <div className={`rounded-xl p-3 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* AI features */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-purple-500" />
          <h2 className="text-base font-semibold text-gray-900">AI Features</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Optional. Uses your own Anthropic API key for smart categorization, natural-language
          entry, insights, and receipt parsing. Off by default.
        </p>

        {!aiSupported ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-500">
            AI features require the desktop app (they keep your key in OS-secured storage). The web
            version stays fully local with no AI.
          </div>
        ) : (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-700 flex gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                When enabled, only the minimum data per feature is sent to Anthropic (e.g. a merchant
                name, or aggregate totals — never your full transaction list). Everything else stays
                on your device. See the README for specifics.
              </span>
            </div>

            <label className="block text-xs font-medium text-gray-500 mb-1">Anthropic API Key</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  placeholder={status.hasKey ? '•••••••• (a key is saved)' : 'sk-ant-...'}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <button onClick={saveKey} disabled={busy || !keyInput.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
                {status.hasKey ? 'Replace' : 'Save'}
              </button>
              {status.hasKey && (
                <button onClick={removeKey} className="px-3 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Remove</button>
              )}
            </div>
            {!status.encryptionAvailable && (
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> OS secure storage unavailable — the key cannot be stored safely on this machine.
              </p>
            )}

            <label className="flex items-center justify-between mt-4 py-2">
              <span className="text-sm text-gray-700">Enable AI features</span>
              <button
                onClick={() => toggleAi(!aiEnabled)}
                disabled={!status.hasKey}
                className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${aiEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                title={!status.hasKey ? 'Save an API key first' : ''}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${aiEnabled ? 'translate-x-5' : ''}`} />
              </button>
            </label>
          </>
        )}
      </div>

      {/* Backup & restore */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Backup & Restore</h2>
        <p className="text-sm text-gray-500 mb-4">Export a full JSON backup, or restore one (also the way to move data from the web app into the desktop app).</p>
        <div className="flex gap-2">
          <button onClick={() => exportToJSON(state)} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg font-medium">
            <Download className="w-4 h-4" /> Export backup
          </button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg font-medium">
            <Upload className="w-4 h-4" /> Restore backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
        </div>
      </div>

      {/* Demo data */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Demo Data</h2>
        <p className="text-sm text-gray-500 mb-4">
          Fill the app with about 8 months of generated transactions, budgets, goals, debts and a
          Plan Ahead setup, so every chart and insight has something to show. Replaces your current data.
        </p>
        <button
          onClick={loadDemoData}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg font-medium"
        >
          <Wand2 className="w-4 h-4" /> Load demo data
        </button>
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-5">
        <h2 className="text-base font-semibold text-red-700 mb-3">Danger Zone</h2>
        <button
          onClick={() => { if (window.confirm('Reset all data to the sample defaults? This cannot be undone.')) dispatch({ type: 'RESET_DATA' }); }}
          className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm rounded-lg font-medium"
        >
          <Trash2 className="w-4 h-4" /> Reset all data
        </button>
      </div>
    </div>
  );
}
