// Fetch wrapper: same-origin cookies, JSON bodies, CSRF header on writes, uniform errors.
let csrfToken = null;
export const setCsrfToken = (t) => { csrfToken = t; };

export class ApiError extends Error {
  constructor(status, body) {
    const e = body?.error || {};
    super(e.message || `Request failed (${status})`);
    this.status = status;
    this.code = e.code || 'UNKNOWN';
    this.details = e.details;
    this.requestId = e.requestId;
  }
}

function qs(query) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { query, body, raw, headers } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (method !== 'GET' && csrfToken) h['X-CSRF-Token'] = csrfToken;
  let payload;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (raw !== undefined) payload = raw;
  let res;
  try {
    res = await fetch(path + qs(query), { method, headers: h, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' } });
  }
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const json = type.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new ApiError(res.status, json);
    if (res.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new CustomEvent('bj:session-expired'));
    throw err;
  }
  return json;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  upload: uploadWithProgress,
};

/**
 * Upload with real byte progress (fetch cannot report upload progress). `onProgress(loaded, total)` is called with
 * bytes actually handed to the network; once loaded === total the server is parsing and validating.
 */
function uploadWithProgress(kind, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sources/${kind}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', 'text/csv');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded, e.total); };
    xhr.onerror = () => reject(new ApiError(0, { error: { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' } }));
    xhr.onload = () => {
      let json = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(json); return; }
      if (xhr.status === 401) window.dispatchEvent(new CustomEvent('bj:session-expired'));
      reject(new ApiError(xhr.status, json));
    };
    xhr.send(file);
  });
}

export const exportUrl = (path, query) => `${path}${qs(query)}`;
