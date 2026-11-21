import { defineConfig } from 'vite';
import { resolve } from 'path';

// Relative base — funciona tanto em root quanto em subpath (GitHub Pages project site)
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        home:          resolve(__dirname, 'index.html'),
        maisum:        resolve(__dirname, 'games/maisum/index.html'),
        primeiraletra: resolve(__dirname, 'games/primeiraletra/index.html'),
        contaearrasta: resolve(__dirname, 'games/contaearrasta/index.html'),
        cachorro:      resolve(__dirname, 'games/cachorro/index.html'),
        foguete:       resolve(__dirname, 'games/foguete/index.html'),
      },
    },
  },
});
