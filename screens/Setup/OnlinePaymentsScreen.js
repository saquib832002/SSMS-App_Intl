/**
 * screens/Setup/OnlinePaymentsScreen.js – "Online Payments" (school owner / admin)
 *
 * Each school connects ITS OWN payment account, so parents' fee payments go
 * straight to the school:
 *   • Stripe   – international schools: tap "Connect Stripe", finish Stripe's sign-up.
 *   • Razorpay – Indian schools: paste the Key ID + Key Secret from the Razorpay dashboard.
 * Owner can change settings; admin / accountant can view status and payments.
 */
import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch,
  ActivityIndicator, Alert, Linking, AppState, RefreshControl, Modal, FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import {
  getPaymentSettings, connectStripe, refreshStripe, saveRazorpay, setOnlineEnabled,
} from "../../services/OnlinePayApi";
import { COUNTRIES } from "../../constants/Countries";

import { fmtDate as fmtLocalDate } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";
const countryName = (code) => COUNTRIES.find(c => c.code === code)?.name ?? code;

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(String(d).replace(" ", "T"));
  return isNaN(dt) ? String(d) : fmtLocalDate(dt, "medium");
};

export default function OnlinePaymentsScreen({ navigation }) {
  const { user } = useContext(AuthContext);
  const role    = (user?.ssmsUserRole ?? "").toLowerCase().trim();
  const isOwner = role === "owner";

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(null);
  const [keyId,   setKeyId]   = useState("");
  const [secret,  setSecret]  = useState("");
  const [hook,    setHook]    = useState("");
  const [pickCountry, setPickCountry] = useState(false);
  const [countryQ,    setCountryQ]    = useState("");

  const st = data?.settings ?? {};

  const load = useCallback(async (silent = false) => {
    try {
      const d = await getPaymentSettings(user);
      setData(d);
      if (d?.settings?.razorpayKeyId) setKeyId(d.settings.razorpayKeyId);
    } catch (e) {
      // silent: background re-checks (app returning to foreground) must not re-alert every time
      if (!silent) Alert.alert(_t("Online payments"), _tx(e.message));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Back from Stripe's sign-up page → re-check the account
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (s) => {
      if (s !== "active") return;
      if (st.stripeConnected && !st.stripeChargesEnabled) {
        try { await refreshStripe(user); } catch { /* ignore */ }
      }
      load(true);
    });
    return () => sub.remove();
  }, [st.stripeConnected, st.stripeChargesEnabled, user, load]);

  const run = async (name, fn, okMsg) => {
    setBusy(name);
    try {
      await fn();
      await load();
      if (okMsg) Alert.alert(_t("Online payments"), _tx(okMsg));
    } catch (e) {
      Alert.alert(_t("Online payments"), _tx(e.message));
    } finally {
      setBusy(null);
    }
  };

  const onConnectStripe = async (country = null) => {
    setBusy("stripe");
    try {
      const r = await connectStripe(user, country);
      await Linking.openURL(r.url);
      await load();
    } catch (e) {
      if (e.code === "COUNTRY_REQUIRED") {
        setCountryQ("");
        setPickCountry(true);          // ask which country the school's bank account is in
      } else {
        Alert.alert(_t("Online payments"), _tx(e.message));
      }
    } finally {
      setBusy(null);
    }
  };
  const onRefresh       = () => run("refresh", () => refreshStripe(user));
  const onSaveRzp       = () => run("rzp", async () => {
    await saveRazorpay(user, keyId.trim(), secret.trim(), hook.trim());
    setSecret(""); setHook("");
  }, "Razorpay keys saved and checked. Parents can now pay online.");
  const onToggle        = (v) => run("toggle", () => setOnlineEnabled(user, v));
  const onUse           = (p) => run("use", () => setOnlineEnabled(user, true, p));

  if (loading) {
    return <SafeAreaView style={s.center}><ActivityIndicator size="large" color="#1e40af" /></SafeAreaView>;
  }

  const indiaFirst = st.currency === "INR";
  // Which providers this school's country can use (server decides; null = country not set yet)
  const countryKnown = !!st.country;
  const showStripe   = !countryKnown || st.stripeSupported === true;
  const showRzp      = !countryKnown || st.razorpaySupported === true;
  const noProvider   = countryKnown && !showStripe && !showRzp;
  const stripeCard = (
    <View style={s.card} key="stripe">
      <View style={s.row}>
        <View style={[s.logo, { backgroundColor: "#ede9fe" }]}><Feather name="credit-card" size={18} color="#6d28d9" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{_t("Stripe")}</Text>
          <Text style={s.cardSub}>{_t("International schools · cards, Apple Pay, Google Pay")}</Text>
        </View>
        {st.provider === "stripe" && st.available && <Text style={s.badge}>{_t("In use")}</Text>}
      </View>
      {!st.stripeConnected ? (
        <Text style={s.line}>{_t("Connect your school's Stripe account. Stripe asks for your school and bank details; payments go straight to your bank account.")}</Text>
      ) : st.stripeChargesEnabled ? (
        <Text style={[s.line, { color: "#15803d" }]}>{_t("✓ Connected – Stripe can accept payments for your school.")}</Text>
      ) : (
        <Text style={[s.line, { color: "#b45309" }]}>{_t("Stripe still needs some details or is reviewing your account.")}</Text>
      )}
      {isOwner && (
        <View style={s.btnRow}>
          {!st.stripeChargesEnabled && (
            <TouchableOpacity style={s.btn} onPress={() => onConnectStripe()} disabled={!!busy}>
              {busy === "stripe" ? <ActivityIndicator color="#fff" /> :
                <Text style={s.btnTxt}>{st.stripeConnected ? _t("Continue Stripe setup") : _t("Connect Stripe")}</Text>}
            </TouchableOpacity>
          )}
          {st.stripeConnected && (
            <TouchableOpacity style={s.btnGhost} onPress={onRefresh} disabled={!!busy}>
              {busy === "refresh" ? <ActivityIndicator color="#1e40af" /> : <Text style={s.btnGhostTxt}>{_t("Refresh status")}</Text>}
            </TouchableOpacity>
          )}
          {st.stripeChargesEnabled && st.provider !== "stripe" && (
            <TouchableOpacity style={s.btnGhost} onPress={() => onUse("stripe")} disabled={!!busy}>
              <Text style={s.btnGhostTxt}>{_t("Use Stripe")}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  const rzpCard = (
    <View style={s.card} key="rzp">
      <View style={s.row}>
        <View style={[s.logo, { backgroundColor: "#dbeafe" }]}><Feather name="smartphone" size={18} color="#1d4ed8" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{_t("Razorpay")}</Text>
          <Text style={s.cardSub}>{_t("Indian schools · UPI, cards, net banking, wallets")}</Text>
        </View>
        {st.provider === "razorpay" && st.available && <Text style={s.badge}>{_t("In use")}</Text>}
      </View>
      <Text style={s.line}>{_t("In your Razorpay dashboard open Account & Settings → API Keys → Generate key, then paste both values here.")}</Text>
      {isOwner ? (
        <>
          <Text style={s.label}>{_t("Key ID")}</Text>
          <TextInput style={s.input} value={keyId} onChangeText={setKeyId} placeholder="rzp_live_…" autoCapitalize="none" autoCorrect={false} />
          <Text style={s.label}>{_t("Key Secret {v}", { v: st.razorpayConfigured ? _t("(leave blank to keep the saved one)") : "" })}</Text>
          <TextInput style={s.input} value={secret} onChangeText={setSecret} placeholder={st.razorpayConfigured ? _t("•••••••• saved") : _t("Key Secret")} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Text style={s.label}>{_t("Webhook secret (optional, recommended)")}</Text>
          <TextInput style={s.input} value={hook} onChangeText={setHook} placeholder={st.razorpayWebhookSet ? _t("•••••••• saved") : _t("Webhook secret")} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          {!!data?.razorpayWebhookUrl && (
            <Text style={s.hint} selectable>{_t("Webhook URL (Razorpay → Webhooks → Add, events payment.captured):\n{razorpayWebhookUrl}", { razorpayWebhookUrl: data.razorpayWebhookUrl })}</Text>
          )}
          <View style={s.btnRow}>
            <TouchableOpacity style={s.btn} onPress={onSaveRzp} disabled={!!busy || !keyId.trim()}>
              {busy === "rzp" ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>{_t("Save & check keys")}</Text>}
            </TouchableOpacity>
            {st.razorpayConfigured && st.provider !== "razorpay" && (
              <TouchableOpacity style={s.btnGhost} onPress={() => onUse("razorpay")} disabled={!!busy}>
                <Text style={s.btnGhostTxt}>{_t("Use Razorpay")}</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      ) : (
        <Text style={s.line}>{st.razorpayConfigured ? _t("Key {razorpayKeyId} saved.", { razorpayKeyId: st.razorpayKeyId }) : _t("Not set up.")}</Text>
      )}
    </View>
  );

  const stripeCodes    = st.stripeCountries ?? [];
  const shownCountries = COUNTRIES.filter(c => stripeCodes.includes(c.code)).filter(c => {
    const q = countryQ.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q;
  });

  return (
    <SafeAreaView style={s.safe} edges={["bottom"]}>
      <Modal visible={pickCountry} transparent animationType="fade" onRequestClose={() => setPickCountry(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.cardTitle}>{_t("Country of your school's bank account")}</Text>
            <Text style={s.hint}>{_t("Stripe needs this to set up your account. It can't be changed later.")}</Text>
            <TextInput style={[s.input, { marginTop: 10 }]} value={countryQ} onChangeText={setCountryQ}
              placeholder={_t("Search country…")} autoCorrect={false} />
            <FlatList
              data={shownCountries}
              keyExtractor={c => c.code}
              keyboardShouldPersistTaps="handled"
              style={{ marginTop: 8 }}
              renderItem={({ item: c }) => (
                <TouchableOpacity style={s.countryRow}
                  onPress={() => {
                    setPickCountry(false);
                    Alert.alert(_t("Connect Stripe"), _t("Set up Stripe for a school in {name}?", { name: c.name }), [
                      { text: _t("Cancel"), style: "cancel" },
                      { text: _t("Continue"), onPress: () => onConnectStripe(c.code) },
                    ]);
                  }}>
                  <Text style={s.countryTxt}>{_tx(c.name)}</Text>
                  <Text style={s.paySub}>{_tx(c.currency)}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={[s.btnGhost, { marginTop: 10 }]} onPress={() => setPickCountry(false)}>
              <Text style={s.btnGhostTxt}>{_t("Cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Feather name="arrow-left" size={20} color="#0f172a" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{_t("Online Payments")}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <View style={s.card}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{_t("Parents pay fees online")}</Text>
              <Text style={s.cardSub}>
                {st.available
                  ? _t("On · {v} · {currency}", { v: st.provider === "razorpay" ? _t("Razorpay") : _t("Stripe"), currency: st.currency })
                  : st.enabled ? _t("On, but the payment account is not ready yet") : _t("Off")}
              </Text>
            </View>
            <Switch
              value={!!st.enabled}
              onValueChange={onToggle}
              disabled={noProvider || !isOwner || !!busy || (!st.stripeChargesEnabled && !st.razorpayConfigured)}
            />
          </View>
          <Text style={s.hint}>{_t("Money goes straight to your school's own account. Online payments appear in Collection Approval as \"Online – Stripe/Razorpay\" for the owner to approve, like counter payments.")}</Text>
          {!isOwner && <Text style={s.hint}>{_t("Only the school owner can change these settings.")}</Text>}
          {isOwner && !noProvider && !st.stripeChargesEnabled && !st.razorpayConfigured && (
            <Text style={[s.hint, { color: "#b45309" }]}>
              {st.stripeConnected
                ? _t("The switch unlocks once Stripe has finished checking your account. Tap “Continue Stripe setup” to complete any missing details, then “Refresh status”.")
                : _t("The switch unlocks after you connect a payment account below.")}
            </Text>
          )}
        </View>

        {noProvider ? (
          <View style={[s.card, { backgroundColor: "#fffbeb", borderColor: "#fde68a" }]}>
            <Text style={s.cardTitle}>{_t("Not available in {country} yet", { country: countryName(st.country) })}</Text>
            <Text style={s.line}>{_t("Online fee payments use Stripe (international) or Razorpay (India). Neither supports schools in {country} at the moment, so online payments are switched off for your school. Parents can keep paying at the school office.", { country: countryName(st.country) })}</Text>
          </View>
        ) : (
          (indiaFirst ? [showRzp && rzpCard, showStripe && stripeCard] : [showStripe && stripeCard, showRzp && rzpCard]).filter(Boolean)
        )}

        <Text style={s.section}>{_t("Recent online payments")}</Text>
        {(data?.payments ?? []).length === 0 ? (
          <Text style={s.hint}>{_t("No online payments yet.")}</Text>
        ) : (
          (data.payments).map((p) => (
            <View key={p.id} style={s.payRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.payName}>{_tx(p.student_name) || _t("Enrollment {enrollment_id}", { enrollment_id: p.enrollment_id })}</Text>
                <Text style={s.paySub}>{fmtDate(p.paid_at || p.created_at)} · {_tx(p.provider)}{p.receipt_number ? ` · ${_tx(p.receipt_number)}` : ""}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.payAmt}>{Number(p.amount).toFixed(2)} {_tx(p.currency)}</Text>
                <Text style={[s.payStatus, p.status === "paid" ? s.ok : s.pending]}>{p.status === "paid" ? _t("Paid") : _t("Not paid")}</Text>
              </View>
            </View>
          ))
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
  body:        { padding: 16, paddingBottom: 60 },
  card:        { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#e2e8f0", padding: 14, marginBottom: 12 },
  row:         { flexDirection: "row", alignItems: "center", gap: 10 },
  logo:        { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle:   { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  cardSub:     { fontSize: 12, color: "#64748b", marginTop: 2 },
  badge:       { fontSize: 11, fontWeight: "800", color: "#15803d", backgroundColor: "#dcfce7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  line:        { fontSize: 13, color: "#334155", marginTop: 10, lineHeight: 19 },
  label:       { fontSize: 12, color: "#64748b", marginTop: 10, marginBottom: 4 },
  input:       { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: "#0f172a", backgroundColor: "#fff" },
  hint:        { fontSize: 12, color: "#64748b", marginTop: 8, lineHeight: 17 },
  btnRow:      { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  btn:         { backgroundColor: "#1e40af", borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, minWidth: 140, alignItems: "center" },
  btnTxt:      { color: "#fff", fontWeight: "800", fontSize: 14 },
  btnGhost:    { backgroundColor: "#eff6ff", borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16, alignItems: "center" },
  btnGhostTxt: { color: "#1e40af", fontWeight: "800", fontSize: 14 },
  section:     { fontSize: 14, fontWeight: "800", color: "#0f172a", marginTop: 8, marginBottom: 8 },
  payRow:      { flexDirection: "row", backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, marginBottom: 8 },
  payName:     { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  paySub:      { fontSize: 12, color: "#64748b", marginTop: 2 },
  payAmt:      { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  payStatus:   { fontSize: 11, fontWeight: "800", marginTop: 2 },
  ok:          { color: "#15803d" },
  pending:     { color: "#94a3b8" },
  overlay:     { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "center", padding: 20 },
  sheet:       { backgroundColor: "#fff", borderRadius: 16, padding: 16, height: "75%" },
  countryRow:  { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  countryTxt:  { fontSize: 14, color: "#0f172a" },
});
