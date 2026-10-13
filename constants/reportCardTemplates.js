/**
 * Report card HTML templates (printed to PDF with expo-print).
 *
 *   buildReportCardHTML(rc, logoDataUri)  → full HTML document
 *   loadSchoolLogo(user, logoName)        → data: URI (expo-print can't load remote images)
 *
 * rc = response of ReportCardApi.getReportCard():
 *   { plan, scale, student, terms[], subjects[], overall, comment, attendance, rank, class_size, school }
 * Templates: "classic" (formal, bordered), "modern" (colour header, cards),
 *            "compact" (one dense page, comments listed under the table).
 */
import { HOST_NAME } from "../Environment/EnvironmentConfig";
import { _t } from "../services/i18n";

export const TEMPLATE_OPTIONS = [
  { value: "classic", get label() { return _t("Classic – formal, bordered"); } },
  { value: "modern",  get label() { return _t("Modern – colour header, cards"); } },
  { value: "compact", get label() { return _t("Compact – one dense page"); } },
];

const THEMES = {
  classic: { ink: "#0f172a", brand: "#1e3a8a", soft: "#eff6ff", line: "#94a3b8", font: "Georgia, 'Times New Roman', serif", base: 10.5 },
  modern:  { ink: "#0f172a", brand: "#4f46e5", soft: "#eef2ff", line: "#e2e8f0", font: "'Helvetica Neue', Arial, sans-serif", base: 10.5 },
  compact: { ink: "#111827", brand: "#0f766e", soft: "#f0fdfa", line: "#cbd5e1", font: "Arial, sans-serif", base: 9 },
};

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(Number(v) % 1 === 0 ? 0 : 1)}%`);
const num = (v, d = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));

export async function loadSchoolLogo(user, logoName) {
  if (!logoName) return null;
  const base = (HOST_NAME ?? "").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/clients/${user?.ssmsClientCode}/${logoName}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function buildReportCardHTML(rc, logoDataUri = null) {
  const plan     = rc.plan ?? {};
  const tpl      = THEMES[plan.template] ? plan.template : "classic";
  const t        = THEMES[tpl];
  const school   = rc.school ?? {};
  const st       = rc.student ?? {};
  const terms    = rc.terms ?? [];
  const subjects = rc.subjects ?? [];
  const ov       = rc.overall ?? {};
  const showGpa  = !!plan.show_gpa && subjects.some((s) => s.gpa_points !== null && s.gpa_points !== undefined);
  const showTerms = plan.show_term_columns !== false && terms.length > 0;
  const schoolName = school.ssms_client_header_text || school.ssms_client_name || "School";
  const inlineComments = tpl !== "compact";
  const anyComment = subjects.some((s) => s.comment);

  const logo = logoDataUri
    ? `<img class="logo" src="${logoDataUri}"/>`
    : `<div class="logo logo-txt">${esc(schoolName.charAt(0))}</div>`;

  const termHead = showTerms
    ? terms.map((x) => `<th>${esc(x.label)}<div class="w">${num(x.weight, 0)}%</div></th>`).join("")
    : "";

  const rows = subjects.map((s, i) => {
    const cells = showTerms ? s.terms.map((c) => {
      if (!c) return `<td class="c muted">—</td>`;
      if (c.absent) return `<td class="c abs">Abs</td>`;
      return `<td class="c">${pct(c.percent)}<div class="sub">${num(c.obtained, 0)}/${num(c.max, 0)}</div></td>`;
    }).join("") : "";
    const fail = s.is_pass === false;
    return `<tr class="${i % 2 ? "alt" : ""}">
      <td class="subj">${esc(s.subject_name)}</td>
      ${cells}
      <td class="c b">${pct(s.percent)}</td>
      <td class="c grade ${fail ? "fail" : ""}">${esc(s.grade ?? "—")}${s.descriptor && tpl === "modern" ? `<div class="sub">${esc(s.descriptor)}</div>` : ""}</td>
      ${showGpa ? `<td class="c">${s.gpa_points === null || s.gpa_points === undefined ? "—" : num(s.gpa_points, 1)}</td>` : ""}
      ${inlineComments && anyComment ? `<td class="cm">${esc(s.comment)}</td>` : ""}
    </tr>`;
  }).join("");

  const colCount = 1 + (showTerms ? terms.length : 0) + 2 + (showGpa ? 1 : 0) + (inlineComments && anyComment ? 1 : 0);

  const compactComments = !inlineComments && anyComment
    ? `<div class="box"><div class="box-h">Subject comments</div>${subjects.filter((s) => s.comment)
        .map((s) => `<p class="sc"><b>${esc(s.subject_name)}:</b> ${esc(s.comment)}</p>`).join("")}</div>`
    : "";

  const stats = [
    ["Overall", pct(ov.percent)],
    ["Grade", esc(ov.grade ?? "—")],
    showGpa && ov.gpa !== null && ov.gpa !== undefined ? ["GPA", num(ov.gpa, 2)] : null,
    rc.rank ? ["Rank", `${rc.rank}${rc.class_size ? ` / ${rc.class_size}` : ""}`] : null,
    rc.attendance ? ["Attendance", `${rc.attendance.percent === null || rc.attendance.percent === undefined ? "—" : `${rc.attendance.percent}%`}<div class="sub">${rc.attendance.present}/${rc.attendance.total} days${rc.attendance.leave ? ` · ${rc.attendance.leave} leave` : ""}</div>`] : null,
    ["Result", esc(ov.result ?? "—")],
  ].filter(Boolean);

  const key = (rc.scale?.bands ?? []).map((b) =>
    `<span class="k"><b>${esc(b.label)}</b> ${Number(b.min_percent)}%+${b.descriptor ? ` ${esc(b.descriptor)}` : ""}</span>`).join("");

  const info = [
    ["Student", st.student_name], ["Class", [st.class_name, st.section_name].filter(Boolean).join(" – ")],
    ["Roll No.", st.roll_number], ["Session", st.session_name || plan.session_name],
    ["Reg. No.", st.registration_id], st.branch_name ? ["Branch", st.branch_name] : null,
  ].filter(Boolean).map(([k, v]) => `<div class="i"><span>${esc(k)}</span><b>${esc(v ?? "—")}</b></div>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: ${t.font}; color: ${t.ink}; font-size: ${t.base}px; margin: 0; }
  .hdr { display: flex; align-items: center; justify-content: center; text-align: center; gap: 14px; padding-bottom: 10px;
         ${tpl === "modern" ? `background:${t.brand};color:#fff;padding:14px 16px;border-radius:10px;` : `border-bottom: 2px solid ${t.brand};`} }
  .logo { width: 62px; height: 62px; object-fit: contain; border-radius: 8px; ${tpl === "modern" ? "background:#fff;padding:4px;" : ""} }
  .logo-txt { display:flex; align-items:center; justify-content:center; background:${tpl === "modern" ? "#fff" : t.brand}; color:${tpl === "modern" ? t.brand : "#fff"}; font-size:26px; font-weight:800; }
  .hdr h1 { margin: 0; font-size: ${t.base + 8}px; letter-spacing: .3px; }
  .hdr .addr { font-size: ${t.base - 1.5}px; opacity: .85; margin-top: 2px; }
  .title { text-align: center; margin: 12px 0 8px; font-size: ${t.base + 4}px; font-weight: 800; color: ${t.brand};
           letter-spacing: 1px; text-transform: uppercase; }
  .info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; padding: 8px 10px; margin-bottom: 10px;
          background: ${t.soft}; border-radius: ${tpl === "classic" ? 0 : 8}px; ${tpl === "classic" ? `border:1px solid ${t.line};` : ""} }
  .i span { display:block; font-size:${t.base - 2}px; color:#64748b; text-transform:uppercase; letter-spacing:.4px; }
  .i b { font-size:${t.base}px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: ${t.brand}; color: #fff; font-size: ${t.base - 1}px; padding: 6px 5px; text-align: center; font-weight: 700; }
  th:first-child { text-align: left; }
  td { padding: 5px; border-bottom: 1px solid ${t.line}; vertical-align: middle; }
  ${tpl === "classic" ? `td, th { border: 1px solid ${t.line}; }` : ""}
  tr.alt td { background: ${tpl === "classic" ? "#fff" : "#f8fafc"}; }
  .c { text-align: center; } .b { font-weight: 700; }
  .subj { font-weight: 700; }
  .grade { font-weight: 800; color: ${t.brand}; font-size: ${t.base + 1}px; }
  .fail { color: #b91c1c; } .abs { color:#b91c1c; font-weight:700; } .muted { color:#94a3b8; }
  .sub, .w { font-size: ${t.base - 2.5}px; color: #64748b; font-weight: 400; }
  th .w { color: #e0e7ff; }
  .cm { font-size: ${t.base - 1}px; color: #334155; }
  .stats { display: flex; gap: 8px; margin: 12px 0; }
  .stat { flex: 1; text-align: center; padding: 8px 4px; border: 1px solid ${t.line};
          border-radius: ${tpl === "classic" ? 0 : 8}px; background: ${tpl === "modern" ? t.soft : "#fff"}; }
  .stat span { display:block; font-size:${t.base - 2}px; color:#64748b; text-transform:uppercase; letter-spacing:.4px; }
  .stat b { font-size: ${t.base + 4}px; color: ${t.brand}; }
  .box { border: 1px solid ${t.line}; border-radius: ${tpl === "classic" ? 0 : 8}px; padding: 8px 10px; margin-bottom: 10px; }
  .box-h { font-weight: 800; color: ${t.brand}; margin-bottom: 4px; font-size: ${t.base}px; }
  .sc { margin: 3px 0; }
  .key { font-size: ${t.base - 2}px; color: #475569; line-height: 1.7; }
  .k { display: inline-block; margin-right: 10px; }
  .sig { display: flex; justify-content: space-between; margin-top: 34px; }
  .sig div { width: 30%; text-align: center; border-top: 1px solid ${t.ink}; padding-top: 4px; font-size: ${t.base - 1}px; }
  .foot { margin-top: 10px; font-size: ${t.base - 2}px; color: #64748b; text-align: center; }
</style></head><body>
  <div class="hdr">${logo}<div><h1>${esc(schoolName)}</h1>
    <div class="addr">${esc([school.ssms_client_address, school.ssms_client_phone, school.ssms_client_email].filter(Boolean).join("  ·  "))}</div></div></div>
  <div class="title">${esc(plan.name || "Report Card")}</div>
  <div class="info">${info}</div>
  <table>
    <thead><tr><th>Subject</th>${termHead}<th>Final</th><th>Grade</th>${showGpa ? "<th>GPA</th>" : ""}${inlineComments && anyComment ? "<th>Teacher comment</th>" : ""}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${colCount}" class="c muted">No marks entered yet.</td></tr>`}</tbody>
  </table>
  <div class="stats">${stats.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
  ${compactComments}
  ${rc.comment ? `<div class="box"><div class="box-h">Class teacher's comment</div>${esc(rc.comment)}</div>` : ""}
  ${key ? `<div class="box"><div class="box-h">Grading key – ${esc(rc.scale?.name ?? "")}</div><div class="key">${key}</div></div>` : ""}
  <div class="sig"><div>Class Teacher</div><div>Parent / Guardian</div><div>${esc(plan.principal_name || "Principal")}</div></div>
  ${plan.footer_note ? `<div class="foot">${esc(plan.footer_note)}</div>` : ""}
</body></html>`;
}
