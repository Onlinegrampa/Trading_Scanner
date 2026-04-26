import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'frontend',
  build: {
    outDir: path.resolve(__dirname, 'dist/display/public'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api':    { target: 'http://localhost:3000', changeOrigin: true },
      '/auth':   { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
