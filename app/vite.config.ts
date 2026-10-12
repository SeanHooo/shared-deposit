import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Codama emits process.env["NODE_ENV"]; browsers have no Node process object.
  define: { 'process.env': JSON.stringify({ NODE_ENV: mode === 'production' ? 'production' : 'development' }) },
}));
