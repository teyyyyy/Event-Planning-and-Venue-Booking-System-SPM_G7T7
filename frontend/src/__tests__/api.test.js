import { describe, expect, vi, beforeEach } from 'vitest';
import { tc } from '../test/tc';
import { json, mockFetch } from '../test/helpers';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('../utils/supabase', () => ({ supabase: { auth: { getSession } } }));

import { request } from '../api';

describe('api.request', () => {
  beforeEach(() => getSession.mockResolvedValue({ data: { session: { access_token: 'tok-1' } } }));

  tc('FE-API-001', 'request', 'A signed-in user calls an API path.',
    'The request goes to <base>/<path> with a JSON content type and "Authorization: Bearer <access token>".',
    { pre: 'A Supabase session with access_token tok-1 exists.', data: 'path = /venue-booking-requests', steps: '1. Call request("/venue-booking-requests").' },
    async () => {
      const fetchMock = mockFetch(() => json([]));
      await request('/venue-booking-requests');
      const [url, options] = fetchMock.mock.calls[0];
      expect(url.endsWith('/api/venue-booking-requests') || url.endsWith('/venue-booking-requests')).toBe(true);
      expect(options.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer tok-1' });
    });

  tc('FE-API-002', 'request', 'No user is signed in.', 'The Authorization header is omitted.',
    { pre: 'getSession returns no session.', kind: 'Edge', steps: '1. Return a null session. 2. Call request("/x").' },
    async () => {
      getSession.mockResolvedValue({ data: { session: null } });
      const fetchMock = mockFetch(() => json({}));
      await request('/x');
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });

  tc('FE-API-003', 'request', 'The server replies 200 with a JSON body.', 'The parsed body is returned.',
    { data: '{"ok": true}', steps: '1. Mock a 200 JSON response. 2. Call request("/x").' },
    async () => {
      mockFetch(() => json({ ok: true }));
      expect(await request('/x')).toEqual({ ok: true });
    });

  tc('FE-API-004', 'request', 'The server replies with an error that has a string "detail".', 'The promise rejects with an Error whose message is the detail.',
    { data: '403 {"detail": "Venue staff access required."}', kind: 'Negative', steps: '1. Mock a 403 response. 2. Call request("/x").' },
    async () => {
      mockFetch(() => json({ detail: 'Venue staff access required.' }, 403));
      await expect(request('/x')).rejects.toThrow('Venue staff access required.');
    });

  tc('FE-API-005', 'request', 'Error response has a non-JSON body.', 'The Error message is "Request failed (500)".',
    { data: '500, body not JSON', kind: 'Negative', steps: '1. Mock a 500 whose json() throws. 2. Call request("/x").' },
    async () => {
      mockFetch(() => ({ ok: false, status: 500, json: async () => { throw new Error('bad json'); } }));
      await expect(request('/x')).rejects.toThrow('Request failed (500)');
    });

  tc('FE-API-006', 'request', 'The server replies 422 with a FastAPI validation-error list.', 'The Error message joins each error as "<field path>: <message>", dropping the leading "body" segment and the "Value error, " prefix.',
    { data: '422 [{loc: ["body","facilities"], msg: "Value error, Each item must be one line."}]', kind: 'Negative', steps: '1. Mock a 422 with a list detail. 2. Call request("/x").' },
    async () => {
      mockFetch(() => json({ detail: [{ loc: ['body', 'facilities'], msg: 'Value error, Each item must be one line.' }, { loc: ['body', 'operating_hours', 'monday'], msg: 'Field required' }] }, 422));
      await expect(request('/x')).rejects.toThrow('facilities: Each item must be one line. operating_hours / monday: Field required');
    });

  tc('FE-API-009', 'request', 'A caller supplies its own headers.', 'They are merged with the defaults: Authorization and Content-Type are kept and the caller\'s header is added.',
    { pre: 'A session with access_token tok-1 exists.', data: 'headers = {"X-Trace": "1"}', kind: 'Regression', steps: '1. Call request("/x", {headers: {"X-Trace": "1"}}).' },
    async () => {
      const fetchMock = mockFetch(() => json({}));
      await request('/x', { headers: { 'X-Trace': '1' } });
      expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok-1', 'X-Trace': '1' });
    });

  tc('FE-API-010', 'request', 'Caller passes an AbortSignal.', 'The signal is forwarded to fetch so the call can be cancelled.',
    { steps: '1. Create an AbortController. 2. Call request("/x", {signal}).' },
    async () => {
      const fetchMock = mockFetch(() => json({}));
      const controller = new AbortController();
      await request('/x', { signal: controller.signal });
      expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    });

  tc('FE-API-007', 'request', 'Successful response has an unparsable body.', 'null is returned instead of throwing.',
    { kind: 'Edge', steps: '1. Mock a 204-style response whose json() throws. 2. Call request("/x").' },
    async () => {
      mockFetch(() => ({ ok: true, status: 204, json: async () => { throw new Error('empty'); } }));
      expect(await request('/x')).toBeNull();
    });

  tc('FE-API-008', 'request', 'Caller passes method and body options.', 'They are forwarded to fetch unchanged.',
    { data: 'POST, body {"a":1}', steps: '1. Call request("/x", {method:"POST", body}).' },
    async () => {
      const fetchMock = mockFetch(() => json({}));
      await request('/x', { method: 'POST', body: '{"a":1}' });
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{"a":1}' });
    });
});
