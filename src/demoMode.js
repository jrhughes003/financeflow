// Whether this bundle is the public demo.
//
// The deployed build seeds a generated ledger and says so in a banner, because
// a finance app opened on an empty database shows fourteen blank pages and
// tells a visitor nothing. Local `npm run dev` keeps starting empty: a
// developer wants their own data, and Settings has a "Load demo data" button
// for when they don't.
//
// A build-time flag rather than a hostname check, so the behaviour is decided
// by how the bundle was built rather than by where it happens to be served.
// Written without optional chaining on purpose: Vite substitutes the literal
// text `import.meta.env.VITE_DEMO_MODE` at build time, and `env?.` is not that
// text — the flag silently stayed false in the built bundle.
export const isDemoBuild = import.meta.env.VITE_DEMO_MODE === 'true';
