import { describe, expect, vi, beforeEach } from 'vitest';
import { tc } from '../test/tc';

const createClient = vi.hoisted(() => vi.fn(() => ({ client: true })));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

async function load(url, key) {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', key);
  return import('../utils/supabase');
}

describe('utils/supabase', () => {
  beforeEach(() => vi.unstubAllEnvs());

  tc('FE-SUPA-001', 'supabase client', 'VITE_SUPABASE_URL is empty.', 'Importing the module throws a "Missing VITE_SUPABASE_URL…" error.',
    { pre: 'URL env value is blank.', kind: 'Config', steps: '1. Blank the URL. 2. Import the module.' },
    async () => { await expect(load('', 'key')).rejects.toThrow(/Missing VITE_SUPABASE_URL/); });

  tc('FE-SUPA-002', 'supabase client', 'VITE_SUPABASE_PUBLISHABLE_KEY is empty.', 'Importing the module throws.',
    { kind: 'Config', steps: '1. Blank the key. 2. Import the module.' },
    async () => { await expect(load('https://a.supabase.co', '')).rejects.toThrow(/Missing/); });

  tc('FE-SUPA-003', 'supabase client', 'URL is configured with a /rest/v1 suffix.', 'createClient receives the bare project URL and the key, with session persistence, auto refresh and URL detection on.',
    { data: 'https://a.supabase.co/rest/v1/', steps: '1. Set the URL with the suffix. 2. Import the module.' },
    async () => {
      await load('https://a.supabase.co/rest/v1/', 'pub-key');
      expect(createClient).toHaveBeenCalledWith('https://a.supabase.co', 'pub-key',
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    });

  tc('FE-SUPA-004', 'supabase client', 'URL has only a trailing slash.', 'The slash is stripped before creating the client.',
    { data: 'https://a.supabase.co/', kind: 'Edge', steps: '1. Set the URL with a trailing slash. 2. Import the module.' },
    async () => {
      await load('https://a.supabase.co/', 'k');
      expect(createClient.mock.calls[0][0]).toBe('https://a.supabase.co');
    });
});
