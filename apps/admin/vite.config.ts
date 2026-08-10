import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // The console and the API are separate Workers on separate origins, so the
  // API base has to be baked in at build time. Without this guard a production
  // build silently ships the dev fallback and every request dies in the
  // browser against localhost — a failure that looks like a broken API.
  if (command === 'build') {
    if (!env.VITE_API_URL) {
      throw new Error(
        'VITE_API_URL is required to build the console, e.g. VITE_API_URL=https://topup-api.<subdomain>.workers.dev',
      );
    }
    // Warn rather than throw: building against a local API is a legitimate way
    // to check a production bundle, and .env.local does exactly that.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(env.VITE_API_URL)) {
      console.warn(`\n⚠ Building against ${env.VITE_API_URL} — do not deploy this bundle.\n`);
    }
  }

  return {
    plugins: [react(), cloudflare()],
    server: { port: 5174 },
    optimizeDeps: { exclude: ['@topup/core'] },
  };
});
