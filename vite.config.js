import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' makes built asset URLs relative so the production bundle loads
// correctly from Electron's file:// origin (win.loadFile(dist/index.html)).
export default defineConfig({
  base: './',
  plugins: [react()],
})
