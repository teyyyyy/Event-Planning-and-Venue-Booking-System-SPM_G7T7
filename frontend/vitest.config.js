import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests run against fixed env values so a developer's real .env is never used.
export default defineConfig({
  plugins: [react()],
  envDir: false,
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/__tests__/**/*.test.{js,jsx}'],
    reporters: ['default', './src/test/register-reporter.js'],
    // Only applies with --coverage (scripts/test-all.sh). New code without tests lowers these and fails the run.
    // Set just under the measured baseline (lines 98.4%, statements 96.3%, functions 97.1%, branches 89.3%).
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/__tests__/**', 'src/test/**', 'src/main.jsx'],
      thresholds: { lines: 98, statements: 96, functions: 94, branches: 88 },
    },
    env: { VITE_API_URL: '', VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-key' },
  },
});
