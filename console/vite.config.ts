import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const envDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');

  // With an empty VITE_LEDGER_URL the console calls its own origin, so in dev
  // we proxy to a real ledger. ledger-core doesn't send CORS headers.
  const proxyTarget = env.VITE_LEDGER_URL ? undefined : env.LEDGER_PROXY_TARGET;

  return {
    envDir,
    plugins: [react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5187,
      strictPort: true,
      proxy: proxyTarget
        ? {
            '/v1': proxyTarget,
            '/readyz': proxyTarget,
          }
        : undefined,
    },
    preview: { port: 5187, strictPort: true },
  };
});
