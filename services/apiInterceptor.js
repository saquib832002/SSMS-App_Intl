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
    const err = new Error('User logged out');
    err.name  = 'LoggedOutError';
    throw err;
  }
  const res = await fetch(url, options);
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
  const res = await fetch(url, options);
  checkLocked(res);
  return res;
}
