import { defineConfig } from 'vite';

/**
 * The proxy target is overridable so a second dev server can point at its own game
 * server instead of fighting the one already on 8787. Two sessions on one machine
 * otherwise share a world neither of them started.
 */
const API = process.env.VITE_PROXY ?? 'http://localhost:8787';
const WS = API.replace(/^http/, 'ws');

export default defineConfig({
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api': API,
      '/health': API,
      '/chogs': API,
      '/art': API,
      '/ws': { target: WS, ws: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
