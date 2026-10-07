// Sets the theme before first paint, so a dark-theme user never sees a white
// flash while React boots.
//
// A separate file rather than an inline <script> on purpose: the app ships a
// Content-Security-Policy of script-src 'self' (vite.config.js injects it into
// the built HTML, and electron/main.cjs sends it as a header), which blocks
// inline execution. That policy is what stops a string arriving from a CSV, a
// pasted receipt or an AI response from ever running, so the script moved
// rather than the policy loosening.
//
// The real preference lives in app state — SQLite on the desktop, which cannot
// be read synchronously here — so the last choice is mirrored into localStorage
// by src/utils/theme.ts and read back as a hint. React corrects it a moment
// later if the mirror is stale.
(function () {
  try {
    var saved = localStorage.getItem('financeflow_theme') || 'dark';
    var dark = saved === 'dark'
      || (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    // Private mode or blocked site data: dark is the default theme, and the
    // app corrects it once state loads.
    document.documentElement.dataset.theme = 'dark';
  }
})();
