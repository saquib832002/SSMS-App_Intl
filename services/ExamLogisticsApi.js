/**
 * services/ExamLogisticsApi.js – exam halls, seating plans, invigilation duties, admit cards / hall tickets.
 * Also builds the printable HTML (expo-print): seating charts, door lists, duty roster, hall tickets.
 */
import Constants from "expo-constants";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { safeFetch } from "./apiInterceptor";
import { BASE_URL as _BASE_URL_RAW } from "../Environment/EnvironmentConfig";

import { fmtDate, fmtTime } from "./Locale";
import { _t, _th } from "./i18n";
const BASE_URL = _BASE_URL_RAW.replace(/\/+$/, "");
const APP_VERSION = Constants.expoConfig?.version ?? "";

const headers = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-App-Version": APP_VERSION,
  Authorization: user?.token ? `Bearer ${user.token}` : "",
});

async function call(user, path, method = "GET", body = null, timeoutMs = 30000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await safeFetch(`${BASE_URL}/ExamLogisticsApi/${path}`, {
      method,
      headers: headers(user),
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(_t("The server took too long to answer. Check your connection and try again."));
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = JSON.parse(text); } catch {
    const at = text.indexOf('{"status"');
    if (at > 0) { try { data = JSON.parse(text.slice(at)); } catch { data = null; } }
  }
  if (!data || typeof data !== "object") {
    const e = new Error(_t("The server sent an unexpected reply (HTTP {status}).", { status: res.status }));
    e.status = res.status;
    throw e;
  }
  if (!res.ok || data.status === false) {
    const e = new Error(data.message || _t("Something went wrong. Please try again."));
    e.status = res.status;
    throw e;
  }
  if (data.data === undefined || data.data === null) throw new Error(_t("The server sent an empty reply. Please try again."));
  return data.data;
}

const qs = (o) => Object.entries(o ?? {})
  .filter(([, v]) => v !== undefined && v !== null && v !== "")
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const get = (user, path, f, t) => { const q = qs(f); return call(user, q ? `${path}?${q}` : path, "GET", null, t); };

// office
export const getSetup        = (user) => get(user, "setup");
export const getHalls        = (user, f) => get(user, "halls", f);
export const saveHall        = (user, body) => call(user, "saveHall", "POST", body);
export const deleteHall      = (user, id) => call(user, "deleteHall", "POST", { id });
export const getSittings     = (user, f) => get(user, "sittings", f);
export const getPlan         = (user, id) => get(user, "plan", { id });
export const generatePlan    = (user, body) => call(user, "generatePlan", "POST", body, 60000);
export const moveSeat        = (user, body) => call(user, "moveSeat", "POST", body);
export const publishPlan     = (user, id, publish) => call(user, "publishPlan", "POST", { id, publish: publish ? 1 : 0 });
export const deletePlan      = (user, id) => call(user, "deletePlan", "POST", { id });
export const getDuties       = (user, planId) => get(user, "duties", { plan_id: planId });
export const assignDuty      = (user, body) => call(user, "assignDuty", "POST", body);
export const unassignDuty    = (user, id) => call(user, "unassignDuty", "POST", { id });
export const autoAssign      = (user, planId, perHall) => call(user, "autoAssign", "POST", { plan_id: planId, per_hall: perHall });
export const getRoster       = (user, f) => get(user, "roster", f);
export const getAdmitList    = (user, f) => get(user, "admitList", f, 60000);
export const saveAdmitSettings = (user, body) => call(user, "saveAdmitSettings", "POST", body);
export const setAdmitStatus  = (user, body) => call(user, "setAdmitStatus", "POST", body);
export const publishAdmit    = (user, examId, sessionId, publish) => call(user, "publishAdmit", "POST", { exam_id: examId, session_id: sessionId, publish: publish ? 1 : 0 }, 60000);
export const getPrintCards   = (user, f) => get(user, "printAdmitCards", f, 90000);
// self-service
export const getMyDuties     = (user) => get(user, "myDuties");
export const getMyAdmitCards = (user, enrollmentId) => get(user, "myAdmitCards", { enrollmentId });

// ── formatting ───────────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// dates and times follow the school's Region & formats
export const niceDate = (d) => fmtDate(d, "long") || String(d || "");
export const niceTime = (t) => (/^\d{1,2}:\d{2}/.test(String(t || "")) ? fmtTime(String(t)) : "");
export const timeRange = (a, b) => (a ? `${niceTime(a)}${b ? ` – ${niceTime(b)}` : ""}` : "Time not set");
export const rowLabel = (r) => { let s = ""; while (r > 0) { const m = (r - 1) % 26; s = String.fromCharCode(65 + m) + s; r = Math.floor((r - 1) / 26); } return s; };

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// three validated colours for class identity; text labels always carry the class too
export const CLASS_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
const tint = (hex) => `${hex}22`;

export async function sharePdf(html, title) {
  const { uri } = await Print.printToFileAsync({ html: _th(html) });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: title, UTI: "com.adobe.pdf" });
  return uri;
}

const PAGE = `<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; padding: 0 2px; }
  h2 { font-size: 13px; margin: 14px 0 6px; color: #0f4c81; } .muted { color: #64748b; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #eef4fb; color: #0f4c81; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
  .page { page-break-after: always; } .page:last-child { page-break-after: auto; } .avoid { page-break-inside: avoid; }
  /* letterhead – centred like the mark sheet: logo + school name / address as one centred block, title pill below */
  .lhdr { display: flex; align-items: center; justify-content: center; gap: 14px; border-bottom: 2px solid #0f4c81; padding-bottom: 8px; margin-bottom: 8px; }
  .lhdr .txt { text-align: center; }
  .lhdr h1 { font-size: 19px; color: #0f4c81; font-weight: 800; margin: 0 0 3px; letter-spacing: -0.2px; }
  .lhdr .addr { font-size: 10px; color: #64748b; line-height: 1.5; }
  .ltitle { text-align: center; margin-bottom: 12px; }
  .ltitle .pill { display: inline-block; background: #0f4c81; color: #fff; padding: 3px 20px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; }
  .ltitle .sub { font-size: 10px; color: #64748b; margin-top: 4px; }
</style>`;

/** Letterhead for every printout: logo (or the school's initial) beside the school name, address and phone / email,
 *  centred as one block (same layout as the mark sheet); the document title as a pill underneath. */
export function letterhead(school, title, lines = []) {
  const sc = school ?? {};
  const name = sc.name || "School";
  const logo = sc.logo
    ? `<img src="${sc.logo}" style="width:64px;height:64px;object-fit:contain;flex-shrink:0;"/>`
    : `<div style="width:64px;height:64px;border-radius:50%;background:#0f4c81;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:900;flex-shrink:0;">${esc(name[0])}</div>`;
  const contact = [sc.phone ? `Ph: ${sc.phone}` : "", sc.email ? `Email: ${sc.email}` : ""].filter(Boolean).join("  ·  ");
  const sub = lines.filter(Boolean).map(esc).join("  ·  ");
  return `<div class="lhdr">${logo}<div class="txt"><h1>${esc(name)}</h1>`
    + `${sc.address ? `<div class="addr">${esc(sc.address)}</div>` : ""}${contact ? `<div class="addr">${esc(contact)}</div>` : ""}</div></div>`
    + `<div class="ltitle"><span class="pill">${esc(title)}</span>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}

let _letterhead = null;
/** The school's letterhead (with logo), fetched once per school while the app runs. */
export async function letterheadFor(user) {
  const code = user?.ssmsClientCode ?? "";
  if (_letterhead && _letterhead.code === code) return _letterhead.school;
  try {
    const r = await get(user, "letterhead");
    _letterhead = { code, school: r.school };
    return r.school;
  } catch {
    return { name: user?.schoolName ?? "" };   // print anyway with the name only
  }
}

const today = () => niceDate(new Date().toISOString().slice(0, 10));
const doc = (body) => `<html><head><meta charset="utf-8"/>${PAGE}</head><body>${body}</body></html>`;

/** One page per hall: letterhead, seat grid (front of the room at the top), door list and invigilators. */
export function seatingHtml(plan, school) {
  const classIdx = {};
  plan.halls.forEach((h) => h.seats.forEach((s) => { if (!(s.class_id in classIdx)) classIdx[s.class_id] = Object.keys(classIdx).length; }));
  const pages = plan.halls.filter((h) => h.used > 0).map((h) => {
    const at = {};
    h.seats.forEach((s) => { at[`${s.row}-${s.col}`] = s; });
    const blocked = new Set(h.blocked);
    let grid = "";
    for (let r = 1; r <= h.rows; r++) {
      grid += "<tr>";
      for (let c = 1; c <= h.cols; c++) {
        const lab = `${rowLabel(r)}${c}`;
        const s = at[`${r}-${c}`];
        if (blocked.has(lab)) grid += `<td style="background:#e2e8f0;color:#94a3b8;text-align:center">${lab}<br/>✕</td>`;
        else if (!s) grid += `<td style="text-align:center;color:#94a3b8">${lab}</td>`;
        else {
          const col = CLASS_COLORS[(classIdx[s.class_id] ?? 0) % 3];
          grid += `<td style="text-align:center;border-left:4px solid ${col};background:${tint(col)}"><b>${lab}</b><br/>${esc(s.class_name)}<br/>Roll ${esc(s.roll)}<br/><span class="muted">${esc(s.name)}</span></td>`;
        }
      }
      grid += "</tr>";
    }
    const door = h.door.map((d) => `<tr><td>${esc(d.class_name)}</td><td>${esc(d.from)}${d.to && d.to !== d.from ? ` – ${esc(d.to)}` : ""}</td><td>${d.count}</td></tr>`).join("");
    const inv = h.duties.length ? h.duties.map((d) => `${esc(d.name)} (${esc(d.role_label)})`).join(", ") : "—";
    return `<div class="page">
      ${letterhead(school, "SEATING CHART", [plan.exam.name, niceDate(plan.exam_date), timeRange(plan.start_time, plan.end_time)])}
      <h2 style="margin-top:4px">${esc(h.name)}${h.location ? ` <span class="muted">(${esc(h.location)})</span>` : ""} — ${h.used} students</h2>
      <div class="muted" style="margin-bottom:6px">Front of the room ↑ · Invigilators: ${inv}</div>
      <table>${grid}</table>
      <h2>Door list</h2>
      <table class="avoid"><tr><th>Class</th><th>Roll numbers</th><th>Students</th></tr>${door}</table>
    </div>`;
  }).join("");
  return doc(pages || `${letterhead(school, "SEATING CHART", [plan.exam?.name])}<p>No one is seated yet.</p>`);
}

/** Signing sheet per hall: letterhead, then seat, class, roll, name and a signature column. */
export function attendanceSheetHtml(plan, school) {
  const pages = plan.halls.filter((h) => h.used > 0).map((h) => {
    const rows = [...h.seats].sort((a, b) => a.seat_no - b.seat_no)
      .map((s) => `<tr><td>${s.label}</td><td>${esc(s.class_name)}</td><td>${esc(s.roll)}</td><td>${esc(s.name)}</td><td style="width:30%"></td></tr>`).join("");
    return `<div class="page">
      ${letterhead(school, "ATTENDANCE SHEET", [plan.exam.name, `${h.name} · ${niceDate(plan.exam_date)}`, timeRange(plan.start_time, plan.end_time)])}
      <table><tr><th>Seat</th><th>Class</th><th>Roll</th><th>Student</th><th>Signature</th></tr>${rows}</table>
      <div style="display:flex;justify-content:space-between;margin-top:24px" class="muted">
        <span>Present: ______  Absent: ______</span><span>Invigilator's signature ____________________</span>
      </div>
    </div>`;
  }).join("");
  return doc(pages);
}

export function rosterHtml(r, school) {
  const rows = r.rows.map((x) => `<tr><td>${esc(niceDate(x.exam_date))}</td><td>${esc(timeRange(x.start_time, x.end_time))}</td><td>${esc(x.hall)}</td><td>${esc(x.name)}</td><td>${esc(x.role)}${x.published ? "" : " <span class='muted'>(draft)</span>"}</td></tr>`).join("");
  const load = r.load.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.duties}</td></tr>`).join("");
  return doc(`${letterhead(school, "INVIGILATION ROSTER", [r.exam.name, `Printed ${today()}`])}
    <table><tr><th>Date</th><th>Time</th><th>Hall</th><th>Staff</th><th>Role</th></tr>${rows || "<tr><td colspan=5>No duties yet.</td></tr>"}</table>
    <h2>Duties per person</h2><table class="avoid"><tr><th>Staff</th><th>Duties</th></tr>${load}</table>`);
}

/** Hall tickets – one candidate per A4 page. payload = { school, exam, session, instructions, show_photo, cards: [...] } */
export function admitCardsHtml(payload) {
  const sc = payload.school ?? {};
  const instr = String(payload.instructions ?? "").split(/\r?\n/).filter((l) => l.trim()).map((l) => `<li>${esc(l)}</li>`).join("");
  const row = (k, v) => (v ? `<tr><td style="border:none;width:34%;padding:4px 0" class="muted">${k}</td><td style="border:none;padding:4px 0;font-size:12.5px"><b>${esc(v)}</b></td></tr>` : "");
  const one = (c) => {
    const papers = (c.papers ?? []).map((p) => `<tr><td style="white-space:nowrap">${esc(niceDate(p.exam_date))}</td><td style="white-space:nowrap">${esc(timeRange(p.start_time, p.end_time))}</td><td><b>${esc(p.subject)}</b></td>
      <td>${p.hall ? `${esc(p.hall)} · <b>Seat ${esc(p.seat)}</b>` : esc(p.venue ?? "To be announced")}</td><td></td></tr>`).join("");
    const photo = payload.show_photo
      ? `<div style="width:120px;height:146px;border:1px solid #94a3b8;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">${c.photo ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover"/>` : '<span class="muted" style="font-size:10px;text-align:center;padding:6px">Paste a recent passport-size photo</span>'}</div>` : "";
    return `<div class="page" style="border:2px solid #0f4c81;border-radius:8px;padding:14px 16px;min-height:268mm;display:flex;flex-direction:column">
      ${letterhead(sc, "ADMIT CARD", [payload.exam?.name, payload.session?.name ? _t("School year {name}", { name: payload.session.name }) : ""])}
      <div style="display:flex;justify-content:space-between;align-items:center;background:#eef4fb;border-radius:6px;padding:8px 12px;margin-bottom:12px">
        <span class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Hall ticket no.</span>
        <span style="font-size:20px;font-weight:800;color:#0f4c81;letter-spacing:1px">${esc(c.ticket_no ?? "—")}</span>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:12px">
        <table style="flex:1;border:none">${row("Candidate", c.name)}${row("Class", c.class_name)}${row("Roll number", c.roll)}${row("Registration no.", c.registration_id)}
          ${row("Father's name", c.father)}${row("Mother's name", c.mother)}${row("Date of birth", c.dob ? niceDate(c.dob) : "")}</table>
        ${photo}
      </div>
      <h2>Examination timetable</h2>
      <table style="font-size:10.5px"><tr><th style="width:19%">Date</th><th style="width:21%">Time</th><th>Paper</th><th style="width:24%">Hall · Seat</th><th style="width:14%">Invigilator</th></tr>${papers || '<tr><td colspan="5">The timetable will be shared soon.</td></tr>'}</table>
      ${instr ? `<h2>Instructions</h2><ol style="margin:0 0 0 18px;padding:0;font-size:10.5px;line-height:1.6">${instr}</ol>` : ""}
      <div style="flex:1"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:28px;font-size:10px" class="muted">
        <div style="text-align:center;width:30%"><div style="height:36px"></div><div style="border-top:1px solid #94a3b8;padding-top:3px">Candidate's signature</div></div>
        <div style="text-align:center;width:30%"><div style="height:36px"></div><div style="border-top:1px solid #94a3b8;padding-top:3px">Parent's signature</div></div>
        <div style="text-align:center;width:30%">${sc.signature ? `<img src="${sc.signature}" style="height:36px;object-fit:contain"/>` : '<div style="height:36px"></div>'}<div style="border-top:1px solid #94a3b8;padding-top:3px">Principal</div></div>
      </div>
      <div class="muted" style="font-size:8.5px;text-align:center;margin-top:10px">This admit card must be shown at every paper. Issued by ${esc(sc.name ?? "")} · ${esc(today())}</div>
    </div>`;
  };
  const cards = payload.cards ?? [];
  return doc(cards.length ? cards.map(one).join("") : `${letterhead(sc, "ADMIT CARD", [payload.exam?.name])}<p>No admit cards to print.</p>`);
}
