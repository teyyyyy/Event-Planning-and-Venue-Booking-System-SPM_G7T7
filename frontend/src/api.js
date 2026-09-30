import { supabase } from './utils/supabase';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export async function authenticatedFetch(url, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = { ...(options.headers || {}) };
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'authorization') delete headers[key];
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

export async function request(path, options = {}) {
  const res = await authenticatedFetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const validation = Array.isArray(body?.detail)
      ? body.detail.map((error) => `${error.loc.slice(1).join(' / ')}: ${error.msg.replace(/^Value error, /, '')}`).join(' ')
      : '';
    const message = validation ||
      (body && typeof body.detail === 'string' && body.detail) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}
