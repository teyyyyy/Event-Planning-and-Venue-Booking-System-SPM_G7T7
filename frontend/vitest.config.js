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
    env: { VITE_API_URL: '', VITE_SUPABASE_URL: 'https://test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-key' },
  },
});
