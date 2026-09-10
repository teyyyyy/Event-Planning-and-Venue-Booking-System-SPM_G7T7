import { supabase } from './supabaseClient';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Call the FastAPI backend with the current Supabase access token attached as a
// Bearer header. Auth itself now lives in Supabase; this is for future app data
// endpoints (events, venues, bookings) that the Python backend will verify.
export async function request(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message =
      (body && typeof body.detail === 'string' && body.detail) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}
