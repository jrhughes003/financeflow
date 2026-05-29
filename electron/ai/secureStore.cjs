// Secure storage for the user's Anthropic API key.
//
// The key is encrypted with Electron's safeStorage (OS-backed: DPAPI on Windows,
// Keychain on macOS) and the ciphertext is kept in the SQLite `meta` table as
// base64. The plaintext key only ever exists in memory in the main process at
// call time — it is never written to disk in the clear, bundled, or committed.

const { safeStorage } = require('electron');
const { getMeta, setMeta } = require('../db/repository.cjs');

const KEY_NAME = 'anthropic_api_key_enc';

function isEncryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function setApiKey(db, plaintext) {
  if (!plaintext) {
    clearApiKey(db);
    return;
  }
  if (!isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; cannot store the API key safely.');
  }
  const encrypted = safeStorage.encryptString(plaintext); // Buffer
  setMeta(db, KEY_NAME, encrypted.toString('base64'));
}

function getApiKey(db) {
  const b64 = getMeta(db, KEY_NAME);
  if (!b64) return null;
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return null; // corrupt or undecryptable on this machine
  }
}

function hasApiKey(db) {
  return Boolean(getMeta(db, KEY_NAME));
}

function clearApiKey(db) {
  setMeta(db, KEY_NAME, '');
}

module.exports = { setApiKey, getApiKey, hasApiKey, clearApiKey, isEncryptionAvailable };
