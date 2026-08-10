import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // @topup/core ships untranspiled ESM from the workspace, so Vite must not
  // try to pre-bundle it as an external dependency.
  optimizeDeps: { exclude: ['@topup/core'] },
});
