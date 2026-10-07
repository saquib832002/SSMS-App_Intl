// context/AuthContext.js
import React, { createContext, useState, useEffect, useRef, useCallback } from 'react';
import { Alert, AppState } from 'react-native';
import { setExpiredHandler, setLockedHandler, setLoggedOut } from '../services/apiInterceptor';
import { fetchUserProfile, fetchEntitlements } from '../services/UserServiceApi';

// Module keys introduced for the international (subscription) app.
// Legacy (Indian) schools have never been gated on these, so for them
// hasModule() keeps returning true – their behaviour is unchanged.
const SUBSCRIPTION_MODULE_KEYS = [
  'core', 'attendance', 'notices', 'fees', 'exams',
  'academics', 'assessments', 'communication',
];

export const AuthContext = createContext({
  user:                  null,
  profilePhoto:          null,
  setProfilePhoto:       () => {},
  login:                 () => {},
  logout:                () => {},
  handleExpired:         () => {},
  hasModule:             (_key) => false,
  isSubscription:        false,
  refreshEntitlements:   async () => {},
  activeEnrollmentId:    null,
  setActiveEnrollmentId: () => {},
  linkedStudents:        null,   // null = not yet fetched, [] = fetched (0 or 1), [..] = multiple
  setLinkedStudents:     () => {},
});

// ── navigationRef — kept for backwards compat but no longer used for reset ───
// The AppNavigator auth guard switches stacks automatically when user → null,
// so no manual navigation.reset() is needed on session expiry.
export const navigationRef = React.createRef();

export function AuthProvider({ children }) {
  const [user,                 setUser]                 = useState(null);
  const [profilePhoto,         setProfilePhoto]         = useState(null);
  const [activeEnrollmentId,   setActiveEnrollmentId]   = useState(null);
  const [linkedStudents,       setLinkedStudents]       = useState(null);
  const expiryTimer = useRef(null);
  const warnTimer   = useRef(null);
  const isExpiring  = useRef(false);
  const lastLockAlert = useRef(0);

  const login = useCallback((userData) => {
    isExpiring.current = false;
    setLoggedOut(false); // re-enable API calls and 401 handling
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    // Silence all in-flight and post-logout API calls immediately so no
    // "authorization token missing" or "Session Expired" alerts appear.
    isExpiring.current = true;
    setLoggedOut(true);
    setUser(null);
    setProfilePhoto(null);
    setActiveEnrollmentId(null);
    setLinkedStudents(null);
    clearTimeout(expiryTimer.current);
    clearTimeout(warnTimer.current);
    expiryTimer.current = null;
    warnTimer.current   = null;
  }, []);

  // ── Called on 401/403 from any API or when timer fires ───────────────────
  const handleExpired = useCallback(() => {
    if (isExpiring.current) return; // prevent duplicate alerts
    isExpiring.current = true;
    logout(); // sets user = null → AppNavigator auth guard switches to Login stack
    Alert.alert(
      'Session Expired',
      'Your session has expired. Please log in again.',
      [{ text: 'OK' }]
    );
  }, [logout]);

  // ── Register with apiInterceptor (no circular dep — interceptor has no imports)
  useEffect(() => {
    setExpiredHandler(handleExpired);
  }, [handleExpired]);

  // ── Fetch profile photo right after login ─────────────────────────────────
  useEffect(() => {
    if (!user?.token) return;
    fetchUserProfile(user)
      .then(p => { if (p?.userPhoto) setProfilePhoto(p.userPhoto); })
      .catch(() => {}); // silent — avatar just stays as initials
  }, [user?.token]); // re-runs on each new login session

  // ── Auto-logout timer ─────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(expiryTimer.current);
    clearTimeout(warnTimer.current);
    if (!user?.expiresAt) return;

    const msLeft = user.expiresAt - Date.now();
    if (msLeft <= 0) { handleExpired(); return; }

    // Warn 2 mins before expiry
    const warnMs = Math.max(0, msLeft - 2 * 60 * 1000);
    warnTimer.current = setTimeout(() => {
      if (!isExpiring.current) {
        Alert.alert('Session Expiring Soon',
          'Your session will expire in 2 minutes. Please save your work.',
          [{ text: 'OK' }]
        );
      }
    }, warnMs);

    // Force logout at expiry
    expiryTimer.current = setTimeout(handleExpired, msLeft);

    return () => {
      clearTimeout(expiryTimer.current);
      clearTimeout(warnTimer.current);
    };
  }, [user?.expiresAt, handleExpired]);

  const isSubscription = user?.billingModel === 'subscription';

  // Returns true if the module key is granted for the logged-in client.
  //  • Subscription (international) schools: fail closed – only 'core' and
  //    modules the server says are active.
  //  • Legacy (Indian) schools: unchanged – 'school' and the new keys are
  //    always granted, other keys follow activeModules, and a missing list
  //    falls back to true so existing installs don't break.
  const hasModule = useCallback((key) => {
    if (key === 'school' || key === 'core') return true;
    const modules = user?.activeModules;
    if (user?.billingModel === 'subscription') {
      return Array.isArray(modules) && modules.includes(key);
    }
    if (SUBSCRIPTION_MODULE_KEYS.includes(key)) return true;
    if (!Array.isArray(modules)) return true;   // graceful fallback
    return modules.includes(key);
  }, [user?.activeModules, user?.billingModel]);

  // ── Re-read billing model + modules from the server ───────────────────────
  // Lets upgrades / trial expiry apply without logging out. Only updates the
  // user object when something actually changed, so screens don't reload.
  const refreshEntitlements = useCallback(async () => {
    if (!user?.token) return;
    try {
      const ent = await fetchEntitlements(user);
      if (!ent || !Array.isArray(ent.activeModules)) return;
      const billingModel = ent.billingModel === 'subscription' ? 'subscription' : 'legacy';
      setUser(prev => {
        if (!prev || prev.token !== user.token) return prev;
        const same = prev.billingModel === billingModel
          && JSON.stringify(prev.activeModules ?? []) === JSON.stringify(ent.activeModules);
        return same ? prev : { ...prev, billingModel, activeModules: ent.activeModules };
      });
    } catch {
      // silent – keep the modules we already have
    }
  }, [user?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh whenever the app returns to the foreground
  useEffect(() => {
    if (!user?.token) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshEntitlements();
    });
    return () => sub.remove();
  }, [user?.token, refreshEntitlements]);

  // ── HTTP 402 MODULE_LOCKED from any safeFetch call ────────────────────────
  // One alert per burst (a screen often fires several calls at once).
  const handleLocked = useCallback((info) => {
    const now = Date.now();
    if (now - lastLockAlert.current < 4000) return;
    lastLockAlert.current = now;
    refreshEntitlements();
    Alert.alert(
      'Upgrade required',
      info?.message || "This feature is not included in your school's plan. "
        + 'Please ask your school administrator to upgrade the subscription.',
      [{ text: 'OK' }]
    );
  }, [refreshEntitlements]);

  useEffect(() => {
    setLockedHandler(handleLocked);
  }, [handleLocked]);

  return (
    <AuthContext.Provider value={{
      user, profilePhoto, setProfilePhoto, login, logout, handleExpired, hasModule,
      isSubscription, refreshEntitlements,
      activeEnrollmentId, setActiveEnrollmentId,
      linkedStudents, setLinkedStudents,
    }}>
      {children}
    </AuthContext.Provider>
  );
}