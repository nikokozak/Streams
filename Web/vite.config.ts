import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  // Release builds are loaded from a local file URL inside the app bundle, so
  // assets must be referenced relatively (./assets/...) instead of /assets/...
  base: command === 'build' ? './' : '/',
  build: {
    outDir: '../Sources/Ticker/Resources',
    emptyOutDir: true,
  },
}));
