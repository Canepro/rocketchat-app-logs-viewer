import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = (env.VITE_ROCKETCHAT_API_ORIGIN || '').trim().replace(/\/$/, '');

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: '../resources/web',
      emptyOutDir: true,
    },
    server: apiOrigin
      ? {
          // Keep browser calls same-origin in local dev and proxy app API traffic to Rocket.Chat.
          proxy: {
            '/api/apps/private': {
              target: apiOrigin,
              changeOrigin: true,
              secure: apiOrigin.startsWith('https://'),
            },
            '/api/apps/public': {
              target: apiOrigin,
              changeOrigin: true,
              secure: apiOrigin.startsWith('https://'),
            },
          },
        }
      : undefined,
  };
});
