// context/AuthContext.js
import React, { createContext, useState, useEffect, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import { setExpiredHandler, setLoggedOut } from '../services/apiInterceptor';
import { fetchUserProfile } from '../services/UserServiceApi';

export const AuthContext = createContext({
  user:                  null,
  profilePhoto:          null,
  setProfilePhoto:       () => {},
  login:                 () => {},
  logout:                () => {},
  handleExpired:         () => {},
  hasModule:             (_key) => false,
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

  // Returns true if the module key is granted for the logged-in client.
  // 'school' is always granted. Falls back to true if activeModules is missing
  // (older login responses / dev mode) so existing installs don't break.
  const hasModule = useCallback((key) => {
    if (key === 'school') return true;
    const modules = user?.activeModules;
    if (!Array.isArray(modules)) return true;   // graceful fallback
    return modules.includes(key);
  }, [user?.activeModules]);

  return (
    <AuthContext.Provider value={{
      user, profilePhoto, setProfilePhoto, login, logout, handleExpired, hasModule,
      activeEnrollmentId, setActiveEnrollmentId,
      linkedStudents, setLinkedStudents,
    }}>
      {children}
    </AuthContext.Provider>
  );
}