/**
 * Calendar sync: put school events, holidays, exams, meetings (and for staff: exam duties, cover periods, leave)
 * into Google Calendar, Outlook or Apple Calendar with a private link that stays up to date by itself.
 * The office can also switch on a public link with the school's events and holidays (e.g. for the website).
 */
import React, { useCallback, useContext, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Linking, Share, Platform, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { C, Card, Btn, Empty, Toggle } from "../components/ReportCardUI";
import {
  getMyCalendar, saveMyCalendar, resetMyCalendar, removeMyCalendar, previewCalendar, setSchoolCalendar, partLabel, partHint,
} from "../services/CalendarApi";
import { fmtDate, fmtTime } from "../services/Locale";
import { _t, _tx } from "../services/i18n";

const KIND_ICON = { event: "flag", holiday: "sun", exam: "edit-3", meeting: "users", homework: "book", duty: "clipboard", cover: "repeat", leave: "coffee" };

export default function CalendarSyncScreen() {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const role = String(user?.ssmsUserRole ?? user?.role ?? "").toLowerCase();
  const portal = role === "parent" || role === "student";
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null);     // chosen parts before the link exists
  const [preview, setPreview] = useState(null);

  const shown = React.useRef(false);   // data already on screen → a failed refresh is a message, not a blank page
  const load = useCallback(async () => {
    let r;
    try { r = await getMyCalendar(user); } catch (e) {
      if (shown.current) Alert.alert(_t("Calendar sync"), _tx(e.message)); else setErr(e.message);
      return;
    }
    shown.current = true;
    setD(r); setErr(null);
    const defaults = r.options.filter((o) => o.default).map((o) => o.key);
    let inc = r.feed ? r.feed.include : defaults;
    if (!r.feed) setPick((p) => { if (p) inc = p; return p ?? defaults; });
    previewCalendar(user, inc).then(setPreview).catch(() => setPreview(null));
  }, [user]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn, after) => {
    setBusy(true);
    try { const r = await fn(); if (r) { setD(r); after?.(r); } } catch (e) { Alert.alert(_t("Calendar sync"), _tx(e.message)); } finally { setBusy(false); }
  };

  const create = () => run(() => saveMyCalendar(user, pick), (r) => {
    previewCalendar(user, r.feed?.include).then(setPreview).catch(() => {});
  });
  const toggle = (key) => {
    if (!d.feed) {
      const cur = pick ?? [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      setPick(next);
      previewCalendar(user, next).then(setPreview).catch(() => {});
      return;
    }
    const next = d.feed.include.includes(key) ? d.feed.include.filter((k) => k !== key) : [...d.feed.include, key];
    if (!next.length) { Alert.alert(_t("Calendar sync"), _t("Choose at least one thing to show in your calendar.")); return; }
    run(() => saveMyCalendar(user, next), () => previewCalendar(user, next).then(setPreview).catch(() => {}));
  };
  const reset = () => Alert.alert(_t("Make a new link?"), _t("The old link stops working at once. Calendars that use it must be added again with the new link."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("New link"), style: "destructive", onPress: () => run(() => resetMyCalendar(user)) },
  ]);
  const turnOff = () => Alert.alert(_t("Turn off calendar sync?"), _t("Calendars that use your link stop getting updates. You can also remove the calendar in Google / Outlook / Apple."), [
    { text: _t("Cancel"), style: "cancel" },
    { text: _t("Turn off"), style: "destructive", onPress: () => run(() => removeMyCalendar(user), (r) => setPick(r.options.filter((o) => o.default).map((o) => o.key))) },
  ]);

  const open = async (url, fallback) => {
    try { await Linking.openURL(url); }
    catch { if (fallback) shareLink(fallback); else Alert.alert(_t("Calendar sync"), _t("Could not open it on this phone. Use \"Share link\" and add it in your calendar app.")); }
  };
  const shareLink = (url) => Share.share({ message: url, url }).catch(() => {});

  const school = d?.school;
  const schoolOp = (op) => {
    const go = () => run(async () => { await setSchoolCalendar(user, op); return getMyCalendar(user); });
    if (op === "on") return go();
    Alert.alert(op === "reset" ? _t("Make a new school link?") : _t("Turn off the school link?"),
      _t("Anyone using the current link (e.g. on your website) stops getting updates."), [
        { text: _t("Cancel"), style: "cancel" },
        { text: op === "reset" ? _t("New link") : _t("Turn off"), style: "destructive", onPress: go },
      ]);
  };

  if (!d) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 16 }}>
        {err ? <Card><Empty icon="alert-circle" text={_tx(err)} /></Card> : <ActivityIndicator color={C.brand} style={{ marginTop: 30 }} />}
      </View>
    );
  }
  const f = d.feed;
  const chosen = f ? f.include : (pick ?? []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Card>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Feather name="calendar" size={22} color={C.brand} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{_t("Your school dates in your own calendar")}</Text>
            <Text style={s.meta}>{_t("Add one link to Google Calendar, Outlook or your iPhone. Changes the school makes show up there by themselves (usually within a few hours).")}</Text>
          </View>
        </View>
      </Card>

      {!d.options.length && <Card><Empty icon="lock" text={_t("Calendar sync is not part of your school's plan.")} /></Card>}

      {!!d.options.length && (
        <Card title={_t("What goes in")}>
          {d.options.map((o) => (
            <Toggle key={o.key} label={partLabel(o.key)} hint={partHint(o.key, portal)} value={chosen.includes(o.key)} onChange={() => !busy && toggle(o.key)} />
          ))}
          {!f && <Btn title={_t("Create my calendar link")} icon="link" busy={busy} disabled={!chosen.length} onPress={create} />}
        </Card>
      )}

      {f && (
        <Card title={_t("Add to my calendar")}>
          {!f.public_url && (
            <View style={s.warn}>
              <Feather name="alert-triangle" size={14} color={C.warn} />
              <Text style={[s.meta, { flex: 1, color: C.warn, marginTop: 0 }]}>{_t("This is a test server address. Google and Outlook can only add the link from the live (https) server.")}</Text>
            </View>
          )}
          <Add icon="calendar" label={_t("Google Calendar")} hint={_t("Opens Google Calendar – tap \"Add\". On a phone, it may be easier on a computer.")} onPress={() => open(f.google, f.url)} />
          <Add icon="mail" label={_t("Outlook.com / Hotmail")} onPress={() => open(f.outlook, f.url)} />
          <Add icon="briefcase" label={_t("Outlook (work or school account)")} onPress={() => open(f.outlook_work, f.url)} />
          <Add icon="smartphone" label={Platform.OS === "ios" ? _t("iPhone / iPad calendar") : _t("Apple Calendar / other apps (webcal)")} onPress={() => open(f.webcal, f.url)} />
          <Add icon="share-2" label={_t("Share link")} hint={_t("Copy it into any calendar app that can subscribe to a calendar by URL (iCal).")} onPress={() => shareLink(f.url)} />
          <Text style={s.small}>{_t("Keep this link private: anyone who has it can see these dates.")}</Text>
          {!!f.last_used && <Text style={s.small}>{_t("Last fetched by a calendar app: {when}", { when: fmtDate(f.last_used, "medium") })}</Text>}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <Btn title={_t("New link")} icon="refresh-cw" kind="ghost" busy={busy} onPress={reset} style={{ flex: 1 }} />
            <Btn title={_t("Turn off")} icon="slash" kind="danger" disabled={busy} onPress={turnOff} style={{ flex: 1 }} />
          </View>
        </Card>
      )}

      {!!d.options.length && (
        <Card title={_t("Coming up in your calendar")}>
          {!preview && <ActivityIndicator color={C.brand} />}
          {preview && !preview.events.length && <Text style={s.meta}>{_t("Nothing coming up yet.")}</Text>}
          {preview?.events.slice(0, 12).map((e, i) => (
            <View key={`${e.kind}${i}`} style={s.row}>
              <Feather name={KIND_ICON[e.kind] ?? "calendar"} size={14} color={C.brand} />
              <View style={{ flex: 1 }}>
                <Text style={s.evTitle} numberOfLines={2}>{_tx(e.title)}</Text>
                <Text style={s.meta}>
                  {fmtDate(e.date, "weekdayDayMonth")}{e.end_date && e.end_date !== e.date ? ` – ${fmtDate(e.end_date, "dayMonth")}` : ""}
                  {e.start ? ` · ${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ""}` : ""}{e.where ? ` · ${e.where}` : ""}
                </Text>
              </View>
            </View>
          ))}
          {preview && preview.total > 12 && <Text style={s.small}>{_t("… and {n} more", { n: preview.total - 12 })}</Text>}
        </Card>
      )}

      {school && (
        <Card title={_t("School calendar for everyone")}>
          <Text style={s.meta}>{_t("A public link with the events and holidays marked visible to students and parents – for your website or a parents' group. No exams or personal dates.")}</Text>
          {!school.feed ? (
            <Btn title={_t("Switch on the school link")} icon="globe" kind="ghost" busy={busy} onPress={() => schoolOp("on")} />
          ) : (
            <>
              <Add icon="share-2" label={_t("Share school link")} onPress={() => shareLink(school.feed.url)} />
              <Add icon="calendar" label={_t("Google Calendar")} onPress={() => open(school.feed.google, school.feed.url)} />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <Btn title={_t("New link")} icon="refresh-cw" kind="ghost" busy={busy} onPress={() => schoolOp("reset")} style={{ flex: 1 }} />
                <Btn title={_t("Turn off")} icon="slash" kind="danger" disabled={busy} onPress={() => schoolOp("off")} style={{ flex: 1 }} />
              </View>
            </>
          )}
        </Card>
      )}
    </ScrollView>
  );
}

function Add({ icon, label, hint, onPress }) {
  return (
    <TouchableOpacity style={s.add} onPress={onPress} activeOpacity={0.8}>
      <Feather name={icon} size={17} color={C.brand} />
      <View style={{ flex: 1 }}>
        <Text style={s.addTxt}>{label}</Text>
        {!!hint && <Text style={s.small}>{hint}</Text>}
      </View>
      <Feather name="external-link" size={14} color={C.muted} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "800", color: C.ink },
  meta: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 17 },
  small: { fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 15 },
  warn: { flexDirection: "row", gap: 8, backgroundColor: "#fffbeb", borderRadius: 8, padding: 8, marginBottom: 6 },
  add: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderColor: "#f1f5f9" },
  addTxt: { fontSize: 14, fontWeight: "700", color: C.ink },
  row: { flexDirection: "row", gap: 10, paddingVertical: 7, alignItems: "flex-start" },
  evTitle: { fontSize: 13, fontWeight: "700", color: C.ink },
});
