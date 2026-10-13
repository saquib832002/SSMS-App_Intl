import { _t } from "./i18n";
/**
 * services/apiInterceptor.js
 *
 * Global 401/403 handler — NO imports from AuthContext (avoids circular dep).
 * AuthProvider registers its handleExpired via setExpiredHandler() on mount.
 *
 * _isLoggedOut flag:
 *   Set to true by AuthContext.logout() so that any in-flight or post-logout
 *   API calls are silently aborted instead of showing error alerts.
 *   Cleared back to false by AuthContext.login().
 */

let _handleExpired = null;
let _handleLocked  = null;
let _isLoggedOut   = false;
let _lastLockedAt  = 0;

/**
 * True for ~3 s after a 402 MODULE_LOCKED response. Screens use it to skip
 * their own "Error" alert (AuthContext already shows "Upgrade required").
 */
export function wasJustLocked() {
  return Date.now() - _lastLockedAt < 3000;
}

/** Called by AuthProvider on mount to register the expiry handler */
export function setExpiredHandler(fn) {
  _handleExpired = fn;
}

/**
 * Called by AuthProvider to register the "module locked" (HTTP 402) handler.
 * The backend returns 402 { code: 'MODULE_LOCKED', module, message } when an
 * international (subscription) school calls a module it has not paid for.
 */
export function setLockedHandler(fn) {
  _handleLocked = fn;
}

/** 402 → tell AuthContext (reads a clone so the caller can still read the body). */
export function checkLocked(response) {
  if (response?.status === 402) _lastLockedAt = Date.now();
  if (_isLoggedOut || response?.status !== 402 || !_handleLocked) return;
  try {
    response.clone().json()
      .then(body => _handleLocked(body || {}))
      .catch(() => _handleLocked({}));
  } catch {
    _handleLocked({});
  }
}

/**
 * Call from AuthContext.logout() to suppress all post-logout API noise.
 * Call from AuthContext.login()  to re-enable normal handling.
 */
export function setLoggedOut(value) {
  _isLoggedOut = value;
}

/**
 * Call after every fetch response.
 * Only 401 (Unauthorized / token expired) triggers logout.
 * 403 (Forbidden) means the server understood the request but refused it due
 * to role/permission rules — that is NOT a session expiry and must NOT log the
 * user out (e.g. a parent viewing a child's data returns 403 on some endpoints).
 * Silently skipped when _isLoggedOut is true (user already logged out).
 */
export function checkExpired(response) {
  if (_isLoggedOut) return;
  if (response?.status === 401 && _handleExpired) {
    _handleExpired();
  }
}

/**
 * Drop-in replacement for fetch() that automatically calls checkExpired.
 * Use this in every service file so expired/locked sessions always redirect to Login.
 *
 * After logout, throws a silent AbortError so in-flight calls unwind cleanly
 * without showing any error alerts to the user.
 *
 *   const res = await safeFetch(url, { method: "GET", headers: buildHeaders(user) });
 *   const json = await res.json().catch(() => null);
 */
export async function safeFetch(url, options = {}) {
  if (_isLoggedOut) {
    // User has already logged out — abort the call silently.
    // Screens' catch blocks will receive this but should not show it as an error.
    const err = new Error(_t("User logged out"));
    err.name  = 'LoggedOutError';
    throw err;
  }
  const res = await sendRequest(url, options);
  checkExpired(res);
  checkLocked(res);
  return res;
}

/**
 * fetch() + 402 MODULE_LOCKED detection only (no 401 logout handling).
 * Used by older service files that call fetch() directly, so a locked
 * feature always shows the "Upgrade required" prompt with "View plans".
 */
export async function fetchWithLockCheck(url, options = {}) {
  const res = await sendRequest(url, options);
  checkLocked(res);
  return res;
}

/**
 * Uploads (FormData bodies) go through XMLHttpRequest.
 * Since Expo SDK 52 the global fetch is expo/fetch, which can't send React Native file
 * parts ({ uri, name, type }) and fails with "Unsupported FormDataPart implementation".
 * XMLHttpRequest still uses React Native's own networking, which reads the file from
 * its uri. Everything else keeps using fetch.
 */
function sendRequest(url, options = {}) {
  const body = options?.body;
  const isForm = body && typeof FormData !== 'undefined' && body instanceof FormData;
  return isForm ? xhrRequest(url, options) : fetch(url, options);
}

function xhrRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method || 'POST', url);
    const h = options.headers || {};
    const entries = typeof Headers !== 'undefined' && h instanceof Headers
      ? (() => { const out = []; h.forEach((v, k) => out.push([k, v])); return out; })()
      : Object.entries(h);
    entries.forEach(([k, v]) => {
      // the multipart boundary must come from XHR itself
      if (v !== undefined && v !== null && v !== '' && String(k).toLowerCase() !== 'content-type') xhr.setRequestHeader(k, String(v));
    });
    xhr.timeout = 180000;
    xhr.onload = () => resolve(makeResponse(xhr));
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.ontimeout = () => reject(new TypeError('The upload took too long. Check your connection and try again.'));
    if (options.signal) {
      if (options.signal.aborted) { xhr.abort(); }
      else options.signal.addEventListener?.('abort', () => xhr.abort());
      xhr.onabort = () => { const e = new Error(_t("Aborted")); e.name = 'AbortError'; reject(e); };
    }
    xhr.send(options.body);
  });
}

/** Just enough of the fetch Response for the service files (ok, status, json, text, clone, headers.get). */
function makeResponse(xhr) {
  const text = xhr.responseText ?? '';
  const raw = xhr.getAllResponseHeaders?.() || '';
  const headers = {};
  raw.trim().split(/[\r\n]+/).forEach((line) => {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  });
  const res = {
    ok: xhr.status >= 200 && xhr.status < 300,
    status: xhr.status,
    statusText: xhr.statusText || '',
    url: xhr.responseURL || '',
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null, has: (k) => String(k).toLowerCase() in headers },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
  res.clone = () => ({ ...res });
  return res;
}
