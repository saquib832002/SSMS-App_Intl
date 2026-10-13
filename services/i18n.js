/**
 * services/i18n.js – the app's languages (Setup › Region & formats › Language).
 *
 * Text is written in English in the code and looked up in i18n/<lang>.json ({ "English": "translation" }):
 *   _t("Save")                                → "حفظ"
 *   _t("{count} students", { count: 12 })      → "12 طالب"   (placeholders keep their {name})
 *   _tx(value)                                 → translates a string if it is in the list (labels from data, server
 *                                                messages); anything else is returned unchanged
 *   _th(html)                                  → translates the plain text between tags of a PDF/HTML page and
 *                                                sets right-to-left for Arabic and Urdu
 * Anything missing from a language falls back to English, so a missing translation never breaks a screen.
 * Arabic and Urdu turn the layout right-to-left (fully after the app is next opened).
 */
import React, { useEffect, useState } from "react";
import { I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const LANGUAGES = [
  { code: "en", name: "English", native: "English", rtl: false },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "hi", name: "Hindi", native: "हिन्दी", rtl: false },
  { code: "ur", name: "Urdu", native: "اردو", rtl: true },
  { code: "fr", name: "French", native: "Français", rtl: false },
  { code: "es", name: "Spanish", native: "Español", rtl: false },
];

// Each language file is only loaded when that language is chosen.
const LOADERS = {
  ar: () => require("../i18n/ar.json"),
  hi: () => require("../i18n/hi.json"),
  ur: () => require("../i18n/ur.json"),
  fr: () => require("../i18n/fr.json"),
  es: () => require("../i18n/es.json"),
};

const STORE_KEY = "ssms_language";
let lang = "en";
let dict = null;
let loose = null;          // same list with spaces collapsed, for text cut out of HTML
const listeners = new Set();

export const getLanguage = () => lang;
export const isRTL = () => !!LANGUAGES.find((l) => l.code === lang)?.rtl;

function load(code) {
  if (!LOADERS[code]) return null;
  try { return LOADERS[code]() || null; } catch { return null; }
}

/** Switch language. Returns true when the layout direction changes (fully applied the next time the app opens). */
export function setLanguage(code, { persist = true } = {}) {
  const c = LOADERS[code] ? code : "en";
  const dirChanged = applyDirection(c);
  if (c === lang) return dirChanged;
  lang = c;
  dict = c === "en" ? null : load(c);
  loose = null;
  if (persist) AsyncStorage.setItem(STORE_KEY, c).catch(() => {});
  listeners.forEach((fn) => { try { fn(lang); } catch { /* ignore */ } });
  return dirChanged;
}

function applyDirection(code) {
  const rtl = !!LANGUAGES.find((l) => l.code === code)?.rtl;
  try {
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== rtl) { I18nManager.forceRTL(rtl); return true; }
  } catch { /* ignore */ }
  return false;
}

/** Before the first screen: use the language saved on this phone. */
export async function initLanguage() {
  try {
    const c = await AsyncStorage.getItem(STORE_KEY);
    if (c) setLanguage(c, { persist: false });
  } catch { /* ignore */ }
  return lang;
}

/** Re-renders when the language changes. */
export function useLanguage() {
  const [l, setL] = useState(lang);
  useEffect(() => {
    const fn = (x) => setL(x);
    listeners.add(fn);
    if (l !== lang) setL(lang);
    return () => { listeners.delete(fn); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return l;
}

// one or two letters (grade "A", section "B", status "P") are data, never translated by _tx/_th
const SHORT = /^[A-Za-z]{1,2}[+-]?$/;
const isEmpty = (v) => v === null || v === undefined || typeof v === "boolean";
// a React element (or a list holding one) – shown as pieces instead of text
const isElement = (v) => !!v && typeof v === "object" && (!!v.$$typeof || (Array.isArray(v) && v.some(isElement)));

/** Translate English text; {name} placeholders are filled from vars. */
export function _t(s, vars) {
  if (typeof s !== "string") return s;
  const out = (dict && dict[s]) || s;
  if (!vars) return out;
  const parts = out.split(/(\{\w+\})/);
  let rich = false;
  const vals = parts.map((p) => {
    const m = /^\{(\w+)\}$/.exec(p);
    if (!m || !(m[1] in vars)) return p;
    const v = vars[m[1]];
    if (isEmpty(v)) return "";
    if (isElement(v)) { rich = true; return v; }
    return String(v);
  });
  if (!rich) return vals.join("");
  // a value is a component (e.g. a bold name): give back the pieces so React can show them
  return React.createElement(React.Fragment, null, ...vals.filter((x) => x !== ""));
}

/** Translate a string only if it is in the list (labels from data, server messages). */
export function _tx(v) {
  if (typeof v !== "string" || !dict || SHORT.test(v.trim())) return v;   // grades, sections, codes: A, B+, P
  return dict[v] || dict[v.trim()] || v;
}

function looseDict() {
  if (!loose && dict) {
    loose = {};
    Object.keys(dict).forEach((k) => { loose[k.replace(/\s+/g, " ").trim()] = dict[k]; });
  }
  return loose;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML for PDFs: translate text between tags, and set right-to-left. */
export function _th(html) {
  if (typeof html !== "string") return html;
  let out = html;
  const d = looseDict();
  if (d) {
    out = out.replace(/>([^<>]*[A-Za-z][^<>]*)</g, (m, txt) => {
      const key = txt.replace(/\s+/g, " ").trim();
      const decoded = key.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
      const tr = d[key] || d[decoded];
      if (!tr || SHORT.test(key)) return m;
      const lead = /^\s*/.exec(txt)[0];
      const trail = /\s*$/.exec(txt)[0];
      return `>${lead}${esc(tr)}${trail}<`;
    });
  }
  if (isRTL()) {
    if (/<html[^>]*>/i.test(out)) {
      if (!/<html[^>]*\bdir=/i.test(out)) out = out.replace(/<html/i, '<html dir="rtl"');
    } else {
      out = `<div dir="rtl">${out}</div>`;
    }
  }
  return out;
}
