/**
 * Staff › Office code screen (owner / admin / principal)
 * Leave this open on a tablet or phone at the staff room / front desk.
 * Staff scan the QR or type the 6-digit code in "My Check-in"; it changes every minute,
 * so a code sent over WhatsApp from home stops working almost at once.
 */
import React, { useContext, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { AuthContext } from "../../context/AuthContext";
import { getOfficeCode, getSettings } from "../../services/StaffAttendanceApi";

import { fmtTime } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";
export default function OfficeCodeScreen() {
  const { user } = useContext(AuthContext);
  const [code, setCode]   = useState(null);
  const [qr, setQr]       = useState(null);
  const [left, setLeft]   = useState(0);
  const [err, setErr]     = useState(null);
  const [needed, setNeeded] = useState(true);
  const [clock, setClock] = useState(new Date());
  const timer = useRef(null);
  const expires = useRef(0);
  const fetching = useRef(false);

  useEffect(() => {
    let alive = true;
    const fetchCode = async () => {
      fetching.current = true;
      try {
        const c = await getOfficeCode(user);
        if (!alive) return;
        expires.current = Date.now() + c.expires_in * 1000;
        setCode(c.code); setQr(c.qr ?? null); setLeft(c.expires_in); setErr(null);
      } catch (e) {
        if (alive) { setErr(e.message); expires.current = Date.now() + 10000; }
      } finally { fetching.current = false; }
    };
    getSettings(user).then((s) => alive && setNeeded(!!(s.require_office_code || (s.location_or_code && s.require_location)))).catch(() => {});
    fetchCode();
    // count down against the expiry time; fetch the next code when it runs out
    timer.current = setInterval(() => {
      const now = Date.now();
      setClock(new Date(now));
      const l = Math.ceil((expires.current - now) / 1000);
      if (l <= 0 && !fetching.current) fetchCode();
      setLeft(Math.max(0, l));
    }, 1000);
    return () => { alive = false; clearInterval(timer.current); };
  }, [user]);

  return (
    <ScrollView style={{ backgroundColor: "#1e1b4b" }} contentContainerStyle={sx.wrap}>
      <Text style={sx.clock}>{fmtTime(clock)}</Text>
      <Text style={sx.title}>{_t("Staff check-in code")}</Text>
      {!!qr && (
        <View style={sx.qrBox}>
          <QRCode value={qr} size={220} backgroundColor="#ffffff" color="#1e1b4b" ecl="M" />
        </View>
      )}
      {!code && !err ? <ActivityIndicator color="#fff" size="large" /> : (
        <Text style={sx.code} adjustsFontSizeToFit numberOfLines={1}>
          {code ? `${code.slice(0, 3)} ${code.slice(3)}` : "— — —"}
        </Text>
      )}
      {!!err && <Text style={sx.err}>{_tx(err)}</Text>}
      <View style={sx.barWrap}><View style={[sx.bar, { width: `${Math.max(0, Math.min(100, (left / 60) * 100))}%` }]} /></View>
      <Text style={sx.sub}>{_t("New code in {left}s", { left })}</Text>
      <Text style={sx.help}>
        {qr ? _t("Open the app › My Check-in › Scan QR (or type the code)") : _t("Open the app › My Check-in › type this code › Check in")}
      </Text>
      {!needed && (
        <Text style={sx.warn}>{_t("The code is not required right now. Turn on \"Require the office code\" in Staff Attendance › Settings.")}</Text>
      )}
    </ScrollView>
  );
}

const sx = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  qrBox: { backgroundColor: "#fff", padding: 16, borderRadius: 18, marginBottom: 12 },
  clock: { color: "#c7d2fe", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  title: { color: "#e0e7ff", fontSize: 20, fontWeight: "800", marginBottom: 16, textTransform: "uppercase", letterSpacing: 1 },
  code: { color: "#fff", fontSize: 64, fontWeight: "900", letterSpacing: 6, fontVariant: ["tabular-nums"] },
  barWrap: { width: "70%", height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.15)", marginTop: 20, overflow: "hidden" },
  bar: { height: 8, backgroundColor: "#a5b4fc" },
  sub: { color: "#c7d2fe", marginTop: 8, fontSize: 14, fontWeight: "600" },
  help: { color: "#a5b4fc", marginTop: 28, fontSize: 14, textAlign: "center" },
  warn: { color: "#fde68a", marginTop: 16, fontSize: 13, textAlign: "center" },
  err: { color: "#fecaca", marginTop: 10, textAlign: "center" },
});
