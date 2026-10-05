import { vi } from 'vitest';

export function json(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

// handler(url, options) -> json(...) | throws. Returns the vi.fn for call assertions.
export function mockFetch(handler) {
  const fn = vi.fn(async (url, options = {}) => handler(String(url), options));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const callsTo = (fn, part, method) =>
  fn.mock.calls.filter(([url, opts]) => String(url).includes(part) && (!method || (opts?.method || 'GET') === method));
