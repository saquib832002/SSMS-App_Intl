/**
 * Report card + class + section pickers shared by the comments and report card screens.
 * Auto-selects when there is only one option.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { getPlans } from "../services/ReportCardApi";
import { fetchClasses, fetchSections } from "../services/SetupServiceApi";
import { Picker } from "./ReportCardUI";
import { _t, _tx } from "../services/i18n";

export function useReportCardFilters(user) {
  const [plans, setPlans]       = useState([]);
  const [classes, setClasses]   = useState([]);
  const [sections, setSections] = useState([]);
  const [planId, setPlanId]     = useState("");
  const [classId, setClassId]   = useState("");
  const [sectionId, setSectionId] = useState("");
  const [ready, setReady]       = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [rp, c] = await Promise.all([getPlans(user), fetchClasses(user).catch(() => [])]);
        if (!alive) return;
        const p = Array.isArray(rp) ? rp : [];
        setPlans(p);
        setClasses(Array.isArray(c) ? c : []);
        if (p.length === 1) setPlanId(String(p[0].id));
      } catch (e) {
        if (alive) Alert.alert(_t("Report cards"), _tx(e.message) || _t("Could not load report cards."));
      } finally { if (alive) setReady(true); }
    })();
    return () => { alive = false; };
  }, [user?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => plans.find((p) => String(p.id) === String(planId)) ?? null, [plans, planId]);

  // A report card for one class → that class.
  useEffect(() => { if (plan?.class_id) setClassId(String(plan.class_id)); }, [plan?.class_id]);

  useEffect(() => {
    setSectionId(""); setSections([]);
    if (!classId) return;
    fetchSections(user, classId).then((r) => {
      const list = (Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])).map((s) => ({ id: String(s.section_id ?? s.id), name: s.section_name ?? s.name }));
      setSections(list);
      if (list.length === 1) setSectionId(list[0].id);
    }).catch(() => {});
  }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { plans, classes, sections, plan, planId, setPlanId, classId, setClassId, sectionId, setSectionId, ready };
}

export function ReportCardFilters({ f }) {
  const planOpts = f.plans.map((p) => ({ value: String(p.id), label: p.name,
    sub: [p.session_name, p.class_name || "All classes", p.is_published ? "Published" : "Draft"].filter(Boolean).join(" · ") }));
  const classOpts = f.classes
    .filter((c) => !f.plan?.class_id || String(c.class_id) === String(f.plan.class_id))
    .map((c) => ({ value: String(c.class_id), label: c.class_name }));
  const secOpts = [{ value: "", label: _t("All sections") }, ...f.sections.map((s) => ({ value: s.id, label: s.name }))];
  return (
    <View>
      <Picker label={_t("Report card")} value={f.planId} options={planOpts} placeholder={_t("Choose a report card")} onChange={f.setPlanId} />
      <Picker label={_t("Class")} value={f.classId} options={classOpts} placeholder={_t("Choose class")} onChange={f.setClassId} disabled={!f.planId} />
      {f.sections.length > 0 && (
        <Picker label={_t("Section")} value={f.sectionId} options={secOpts} onChange={f.setSectionId} />
      )}
    </View>
  );
}
