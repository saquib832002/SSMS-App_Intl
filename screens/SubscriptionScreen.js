/**
 * screens/SubscriptionScreen.js  –  "Plan & Billing"
 *
 * For subscription (international) schools:
 *   • current status (free trial / plan / renews or ends on / payment problem)
 *   • plans with Google Play prices and a Subscribe button (owner/admin only)
 *   • Restore purchases, Manage in Google Play
 * After a purchase the server is asked to re-read the Play subscription,
 * then the app refreshes its features – locked screens open straight away.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, Linking, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthContext } from "../context/AuthContext";
import { FEATURE_LABELS } from "../constants/RouteFeatures";
import { fetchSubscriptionStatus, fetchPlans, syncPlayPurchase } from "../services/SubscriptionServiceApi";
import {
  initPlayBilling, getPlayPackages, buyPackage, restorePlayPurchases,
  playBillingUnavailableReason, baseProductId, MANAGE_SUBSCRIPTIONS_URL,
} from "../services/PlayBilling";
import { _t, _tx } from "../services/i18n";
import { fmtDate as fmtLocalDate } from "../services/Locale";

/** true for a yearly Play base plan / RevenueCat annual package */
const isYearlyPackage = (p) => {
  const id     = String(p?.product?.identifier ?? "");
  const period = String(p?.product?.subscriptionPeriod ?? "");
  return /:year/i.test(id) || /:annual/i.test(id) || period === "P1Y"
      || String(p?.packageType ?? "").toUpperCase() === "ANNUAL";
};

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(String(d).replace(" ", "T"));
  return isNaN(dt) ? String(d) : fmtLocalDate(dt, "medium");   // school's date format and language
};

export default function SubscriptionScreen({ navigation }) {
  const { user, refreshEntitlements } = useContext(AuthContext);
  const role    = (user?.ssmsUserRole ?? "").toLowerCase().trim();
  const isAdmin = ["owner", "admin", "super", "superuser"].includes(role);
  const unavailable = playBillingUnavailableReason();

  const [status,   setStatus]   = useState(null);
  const [plans,    setPlans]    = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(null);   // planCode being bought / "restore"
  const [error,    setError]    = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      // allSettled: show whatever loaded; one denied call must not hide the other
      const [rSt, rPl] = await Promise.allSettled([fetchSubscriptionStatus(user), fetchPlans(user)]);
      const st = rSt.status === "fulfilled" ? rSt.value : null;
      const pl = rPl.status === "fulfilled" ? rPl.value : null;
      setStatus(st ?? null);
      setPlans(Array.isArray(pl) ? pl.filter(p => p?.playProductId) : []);
      const failed = [rSt, rPl].find(r => r.status === "rejected");
      if (failed) setError(failed.reason?.message || _t("Could not load plans."));
      if (!unavailable && isAdmin && (await initPlayBilling(user?.ssmsClientCode))) {
        const raw = await getPlayPackages();
        const pk  = Array.isArray(raw) ? raw : [];
        // Shows in the Metro console: which Google Play products RevenueCat returned
        console.log("[Plan&Billing] Play packages:", pk.map(p => p?.product?.identifier));
        setPackages(pk);
      }
    } catch (e) {
      setError(e?.message || _t("Could not load plans."));
    } finally {
      setLoading(false);
    }
  }, [user?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const sub         = status?.subscription;
  const playSub     = sub?.provider === "google_play" ? sub : null;
  const hasActive   = !!status?.hasActiveSubscription;
  // Plans are sold YEARLY (Play base plan "yearly", e.g. ssms_basic:yearly).
  // Prefer the yearly package; fall back to any package of that subscription.
  const pkgFor      = useCallback(
    (plan) => {
      const mine = packages.filter(p => baseProductId(p?.product?.identifier) === plan.playProductId);
      return mine.find(isYearlyPackage) ?? mine[0];
    },
    [packages]
  );

  const afterStoreChange = useCallback(async (successMsg) => {
    try {
      const st = await syncPlayPurchase(user);
      if (st) setStatus(st);
      await refreshEntitlements();
      Alert.alert(_t("Thank you!"), _tx(successMsg));
    } catch (e) {
      // Payment went through at Google; the webhook will finish the job shortly.
      await refreshEntitlements();
      Alert.alert(_t("Almost done"), _t("Your payment was received. Features will unlock within a minute."));
    }
  }, [user, refreshEntitlements]);

  const onSubscribe = useCallback(async (plan) => {
    const pkg = pkgFor(plan);
    if (!pkg) { Alert.alert(_t("Not available"), _t("This plan is not available in Google Play yet.")); return; }
    setBusy(plan.planCode);
    try {
      const res = await buyPackage(pkg, playSub?.status !== "expired" ? playSub?.storeProductId ?? null : null);
      if (res.ok) await afterStoreChange(_t("{name} is now active for your school.", { name: plan.name }));
    } catch (e) {
      Alert.alert(_t("Purchase failed"), _tx(e?.message) || _t("The purchase could not be completed."));
    } finally {
      setBusy(null);
    }
  }, [pkgFor, playSub, afterStoreChange]);

  const onRestore = useCallback(async () => {
    setBusy("restore");
    try {
      await initPlayBilling(user?.ssmsClientCode);
      await restorePlayPurchases();
      await afterStoreChange("Your school's subscription has been restored.");
    } catch (e) {
      Alert.alert(_t("Restore failed"), _tx(e?.message) || _t("Could not restore purchases."));
    } finally {
      setBusy(null);
    }
  }, [user?.ssmsClientCode, afterStoreChange]);

  // ── Status card text ───────────────────────────────────────────────────
  const statusCard = useMemo(() => {
    if (!status) return null;
    if (status.billingModel !== "subscription") {
      return { icon: "check-circle", title: _t("Standard plan"), line: "Your school is on the standard plan. All modules are included." };
    }
    if (sub && hasActive) {
      const ends = sub.cancelAtPeriodEnd ? "Ends on" : "Renews on";
      return {
        icon: sub.status === "past_due" ? "alert-triangle" : "award",
        title: _t("{v} plan", { v: sub.planName ?? sub.planCode }),
        line: `${ends} ${fmtDate(sub.currentPeriodEnd)}`,
        warn: sub.status === "past_due" ? "Google Play couldn't charge the last payment. Update the payment method in Google Play to keep access." : null,
      };
    }
    if (status.trialEndsAt) {
      const left = Number.isFinite(status.trialDaysLeft) ? status.trialDaysLeft : null;
      const leftTxt = left === null ? "" : left === 0 ? " · last day" : ` · ${left} day${left === 1 ? "" : "s"} left`;
      return { icon: "gift", title: _t("Free trial"), line: _t("All features until {trialEndsAt}{leftTxt}", { trialEndsAt: fmtDate(status.trialEndsAt), leftTxt }) };
    }
    return { icon: "lock", title: _t("Free plan"), line: "Student registration and setup are free. Choose a plan to unlock more features." };
  }, [status, sub, hasActive]);

  if (loading) {
    return <SafeAreaView style={s.center}><ActivityIndicator size="large" color="#1e40af" /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Feather name="arrow-left" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{_t("Plan & Billing")}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.body}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        {!!error && <Text style={s.error}>{_tx(error)}</Text>}

        {statusCard && (
          <View style={s.card}>
            <View style={s.row}>
              <View style={s.iconWrap}><Feather name={statusCard.icon} size={20} color="#1e40af" /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{_tx(statusCard.title)}</Text>
                <Text style={s.cardLine}>{_tx(statusCard.line)}</Text>
              </View>
            </View>
            {!!statusCard.warn && <Text style={s.warn}>{_tx(statusCard.warn)}</Text>}
            {!!playSub && isAdmin && (
              <TouchableOpacity style={s.linkBtn} onPress={() => Linking.openURL(MANAGE_SUBSCRIPTIONS_URL)}>
                <Feather name="external-link" size={14} color="#1e40af" />
                <Text style={s.linkTxt}>{_t("Manage or cancel in Google Play")}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {status?.billingModel === "subscription" && (
          <>
            <Text style={s.section}>{_t("Plans")}</Text>
            {!isAdmin && <Text style={s.note}>{_t("Only the school owner or admin can change the plan.")}</Text>}
            {isAdmin && !!unavailable && <Text style={s.note}>{_tx(unavailable)}</Text>}
            {isAdmin && !unavailable && !loading && packages.length === 0 && (
              <Text style={[s.note, { color: "#b45309" }]}>{_t("Google Play didn't return any plans. Check that the yearly base plans are active in Play Console and attached to the \"current\" offering in RevenueCat, and that this app was installed from Google Play.")}</Text>
            )}

            {plans.map((plan) => {
              const pkg      = pkgFor(plan);
              const current  = hasActive && sub?.planCode === plan.planCode;
              const canBuy   = isAdmin && !unavailable && !!pkg && !current;
              return (
                <View key={plan.planCode} style={[s.card, current && s.cardCurrent]}>
                  <View style={s.row}>
                    <Text style={[s.cardTitle, { flex: 1 }]}>{_tx(plan.name)}</Text>
                    {current && <Text style={s.badge}>{_t("Current")}</Text>}
                  </View>
                  <Text style={s.price}>
                    {pkg?.product?.priceString ? `${_tx(pkg.product.priceString)} / ${isYearlyPackage(pkg) ? "year" : "month"}` : (isAdmin && !unavailable ? _t("Not available yet") : "")}
                  </Text>
                  {!!plan.description && <Text style={s.cardLine}>{_tx(plan.description)}</Text>}
                  <View style={{ marginTop: 8 }}>
                    <Text style={s.feature}>{_t("✓ Student registration & setup (always free)")}</Text>
                    {(Array.isArray(plan.modules) ? plan.modules : []).map(m => <Text key={m} style={s.feature}>✓ {_tx(FEATURE_LABELS[m]) ?? _tx(m)}</Text>)}
                  </View>
                  {isAdmin && (
                    <TouchableOpacity
                      style={[s.buyBtn, !canBuy && s.buyBtnOff]}
                      disabled={!canBuy || !!busy}
                      onPress={() => onSubscribe(plan)}
                    >
                      {busy === plan.planCode
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={s.buyTxt}>
                            {current ? _t("Your current plan") : hasActive && playSub ? _t("Switch to {name}", { name: plan.name }) : _t("Subscribe to {name}", { name: plan.name })}
                          </Text>}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {isAdmin && !unavailable && (
              <TouchableOpacity style={s.restore} onPress={onRestore} disabled={!!busy}>
                {busy === "restore"
                  ? <ActivityIndicator color="#1e40af" />
                  : <Text style={s.linkTxt}>{_t("Restore purchases")}</Text>}
              </TouchableOpacity>
            )}
            <Text style={s.small}>{_t("Payments are handled by Google Play. Plans are billed yearly and renew every year until cancelled in Google Play.")}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#f8fafc" },
  center:      { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  back:        { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  body:        { padding: 16, paddingBottom: 40 },
  section:     { fontSize: 15, fontWeight: "800", color: "#0f172a", marginTop: 8, marginBottom: 8 },
  card:        { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", padding: 14, marginBottom: 12 },
  cardCurrent: { borderColor: "#1e40af", borderWidth: 2 },
  row:         { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center" },
  cardTitle:   { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  cardLine:    { fontSize: 13, color: "#475569", marginTop: 2 },
  warn:        { marginTop: 10, fontSize: 13, color: "#b45309", backgroundColor: "#fef3c7", padding: 10, borderRadius: 8 },
  price:       { fontSize: 18, fontWeight: "800", color: "#1e40af", marginTop: 6 },
  feature:     { fontSize: 13, color: "#334155", lineHeight: 21 },
  badge:       { fontSize: 11, fontWeight: "800", color: "#1e40af", backgroundColor: "#e0e7ff", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  buyBtn:      { marginTop: 12, backgroundColor: "#1e40af", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  buyBtnOff:   { backgroundColor: "#94a3b8" },
  buyTxt:      { color: "#fff", fontWeight: "800", fontSize: 15 },
  linkBtn:     { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  linkTxt:     { color: "#1e40af", fontWeight: "700", fontSize: 14 },
  restore:     { alignItems: "center", paddingVertical: 12 },
  note:        { fontSize: 13, color: "#64748b", marginBottom: 10 },
  small:       { fontSize: 12, color: "#94a3b8", textAlign: "center", marginTop: 8 },
  error:       { color: "#b91c1c", backgroundColor: "#fee2e2", padding: 10, borderRadius: 8, marginBottom: 12 },
});
