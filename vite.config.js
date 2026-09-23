import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The same policy the packaged app sends as a header, written into the built
// HTML as a backstop. The header is applied by a session hook in the main
// process, so anything that loads the page without passing through that hook —
// or the web build, which has no main process at all — would otherwise have no
// policy. Build-time only: Vite's HMR needs inline scripts and a websocket, so
// injecting this in dev would break the dev server for no security gain.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // styled-in-JS values, e.g. category colours
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'", // every network call is made by the main process
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const CHARSET = '<meta charset="UTF-8" />'

function contentSecurityPolicy() {
  return {
    name: 'financeflow-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      // Placed after the charset declaration, which browsers want to see first.
      handler(html) {
        if (!html.includes(CHARSET)) {
          throw new Error('index.html charset meta not found; the CSP injection anchors on it')
        }
        const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`
        return html.replace(CHARSET, `${CHARSET}\n    ${meta}`)
      },
    },
  }
}

// base: './' makes built asset URLs relative so the production bundle loads
// correctly from Electron's file:// origin (win.loadFile(dist/index.html)).
export default defineConfig({ base: './', plugins: [react(), contentSecurityPolicy()] })
