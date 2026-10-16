import { defineConfig } from 'vite';

// GitHub Pages serves the app from /<repo>/, so build with a relative base.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node' },
} as never);
