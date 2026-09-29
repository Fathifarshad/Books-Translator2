import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8787';
// Same-origin /api in development and preview; SSE must not be buffered by the proxy.
const proxy = { '/api': { target: API_TARGET, changeOrigin: false } };

// Pure SPA (no SSR) so Capacitor can wrap the build unchanged (SPEC §15).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy },
  build: { target: 'es2022', sourcemap: true },
});
