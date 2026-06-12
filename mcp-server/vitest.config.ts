import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    host: '127.0.0.1',
  },
  test: {
    globals: true,
    testTimeout: 10000,
    setupFiles: ['./tests/gui/setup-gui-globals.ts'],
  },
});
