import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project site under /<repo>/, while local dev and the Node
// server stay at the domain root — the prefix only comes in through the build env.
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  plugins: [react()],
  base,
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
