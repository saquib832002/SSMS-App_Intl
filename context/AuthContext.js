// context/AuthContext.js
import React, { createContext, useState, useEffect, useRef, useCallback } from 'react';
import { Alert, AppState } from 'react-native';
import { setExpiredHandler, setLockedHandler, setLoggedOut } from '../services/apiInterceptor';
import { fetchUserProfile, fetchEntitlements } from '../services/UserServiceApi';
import { FEATURE_LABELS } from '../constants/RouteFeatures';

// Plan feature keys for the international (subscription) app. They come from
// user.activeFeatures (ssms_client_features). Legacy (Indian) schools have
// never been gated on these, so for them hasModule() keeps returning true.
const SUBSCRIPTION_MODULE_KEYS = [
  'core', 'attendance', 'notices', 'fees', 'exams',
  'academics', 'assessments', 'communication',
];
// Product modules – always from user.activeModules (ssms_client_modules),
// exactly as before, for every school.
const PRODUCT_MODULE_KEYS = ['school', 'finance', 'library', 'donation'];

export const AuthContext = createContext({
  user:                  null,
  profilePhoto:          null,
  setProfilePhoto:       () => {},
  login:                 () => {},
  logout:                () => {},
  handleExpired:         () => {},
  hasModule:             (_key) => false,
  hasFeature:            (_key) => true,
  isSubscription:        false,
  showUpgradePrompt:     (_feature) => {},
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
  const lastLockAlert = useRef({});   // feature → time of last "Upgrade required" alert
  // Features the SERVER refused (HTTP 402) during this session. Makes the app
  // behave as a subscription school even if the login data was incomplete.
  const [lockedFeatures, setLockedFeatures] = useState([]);

  const login = useCallback((userData) => {
    isExpiring.current = false;
    setLockedFeatures([]);
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
    setLockedFeatures([]);
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

  // Subscription school if login said so, OR the server has refused a paid feature.
  const isSubscription = user?.billingModel === 'subscription' || lockedFeatures.length > 0;

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
      if (PRODUCT_MODULE_KEYS.includes(key)) {
        return Array.isArray(modules) && modules.includes(key);
      }
      const features = user?.activeFeatures;
      return Array.isArray(features) && features.includes(key);
    }
    if (SUBSCRIPTION_MODULE_KEYS.includes(key)) return true;
    if (!Array.isArray(modules)) return true;   // graceful fallback
    return modules.includes(key);
  }, [user?.activeModules, user?.activeFeatures, user?.billingModel]);

  // Plan feature check used by FeatureGate (screen-level lock).
  //  • Indian (legacy) schools: ALWAYS true – nothing is ever gated for them.
  //  • Subscription schools: 'core' + the features in user.activeFeatures.
  const hasFeature = useCallback((key) => {
    if (!key || key === 'core') return true;
    if (lockedFeatures.includes(key)) return false;           // server said 402
    if (user?.billingModel !== 'subscription') return true;
    const features = user?.activeFeatures;
    return Array.isArray(features) && features.includes(key);
  }, [user?.activeFeatures, user?.billingModel, lockedFeatures]);

  // ── Re-read billing model + modules from the server ───────────────────────
  // Lets upgrades / trial expiry apply without logging out. Only updates the
  // user object when something actually changed, so screens don't reload.
  const refreshEntitlements = useCallback(async () => {
    if (!user?.token) return;
    try {
      const ent = await fetchEntitlements(user);
      if (!ent || !Array.isArray(ent.activeModules)) return;
      const billingModel   = ent.billingModel === 'subscription' ? 'subscription' : 'legacy';
      const activeFeatures = Array.isArray(ent.activeFeatures) ? ent.activeFeatures : ['core'];
      setUser(prev => {
        if (!prev || prev.token !== user.token) return prev;
        // Compare sorted copies so a different order from the server
        // never counts as a change (a change re-renders every screen).
        const key  = (a) => JSON.stringify([...(a ?? [])].sort());
        const same = prev.billingModel === billingModel
          && key(prev.activeModules)  === key(ent.activeModules)
          && key(prev.activeFeatures) === key(activeFeatures);
        return same ? prev : { ...prev, billingModel, activeModules: ent.activeModules, activeFeatures };
      });
      // A feature bought / unlocked since → stop treating it as locked
      if (billingModel === 'subscription') {
        setLockedFeatures(prev => prev.filter(f => !activeFeatures.includes(f)));
      }
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

  // ── "Upgrade required" pop-up ─────────────────────────────────────────────
  // Shown when a locked (paid, not active) option is tapped, or when the
  // server refuses a paid feature (HTTP 402). Owners / admins get
  // "View plans" (opens Plan & Billing); everyone else is told to ask them.
  const showUpgradePrompt = useCallback((feature) => {
    const label   = FEATURE_LABELS[feature] ?? 'This feature';
    const role    = (user?.ssmsUserRole ?? '').toLowerCase().trim();
    const isOwner = ['owner', 'admin', 'super', 'superuser'].includes(role);
    const openPlans = () => {
      try { navigationRef.current?.navigate('Subscription'); } catch { /* ignore */ }
    };
    Alert.alert(
      `\u{1F512} ${label} is locked`,
      "Your school's subscription or free trial has expired, or this feature "
        + "isn't included in your current plan.\n\n"
        + (isOwner
          ? 'Subscribe or upgrade the plan to unlock it for your whole school.'
          : 'Please ask your school administrator to renew or upgrade the subscription.'),
      isOwner
        ? [{ text: 'Not now', style: 'cancel' }, { text: 'View plans', onPress: openPlans }]
        : [{ text: 'OK' }]
    );
  }, [user?.ssmsUserRole]);

  // ── HTTP 402 MODULE_LOCKED from any safeFetch call ────────────────────────
  // At most ONE alert per locked feature every 30 s, however many calls fail
  // (a screen often fires several calls, and some reload on every render).
  // The refresh updates activeFeatures, so FeatureGate then replaces the
  // locked screen with the "not included" screen and the calls stop.
  const handleLocked = useCallback((info) => {
    const feature = info?.module || 'unknown';
    if (info?.code === 'MODULE_LOCKED' && feature !== 'unknown') {
      setLockedFeatures(prev => (prev.includes(feature) ? prev : [...prev, feature]));
    }
    const now     = Date.now();
    if (now - (lastLockAlert.current[feature] || 0) < 30000) return;
    lastLockAlert.current[feature] = now;
    refreshEntitlements();
    showUpgradePrompt(feature);
  }, [refreshEntitlements, showUpgradePrompt]);

  useEffect(() => {
    setLockedHandler(handleLocked);
  }, [handleLocked]);

  return (
    <AuthContext.Provider value={{
      user, profilePhoto, setProfilePhoto, login, logout, handleExpired, hasModule,
      hasFeature, isSubscription, refreshEntitlements, showUpgradePrompt,
      activeEnrollmentId, setActiveEnrollmentId,
      linkedStudents, setLinkedStudents,
    }}>
      {children}
    </AuthContext.Provider>
  );
}