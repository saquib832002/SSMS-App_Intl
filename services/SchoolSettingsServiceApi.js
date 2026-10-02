import { BASE_URL } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";

const buildHeaders = (user) => ({
  Accept:         "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
  // NOTE: No Content-Type — React Native sets multipart/form-data with boundary automatically
});

/**
 * Default ID card field visibility — all fields shown.
 * Merged server-side too, so new fields always default to true.
 */
export const ID_CARD_CONFIG_DEFAULTS = {
  showSchoolLogo:          true,
  showSchoolAddress:       true,
  showSchoolPhone:         true,
  showTagline:             true,
  showStudentPhoto:        true,
  showAdmissionNo:         true,
  showDateOfBirth:         true,
  showBloodGroup:          true,
  showGender:              true,
  showSessionYear:         true,
  showFatherName:          true,
  showMotherName:          true,
  showParentPhone:         true,
  showStudentAddress:      true,
  showBusRoute:            true,
  showEstdYear:            true,
  showQrCode:              true,
  showPrincipalSignature:  true,
  showValidityYear:        true,
  showIfFoundBar:          true,
  showSchoolPhoneInFooter: true,
  // Customizable text
  taglineText:             "LEARN | GROW | SUCCEED",
  ifFoundText:             "If found, please return this card to the school.",
  estdYear:                "2020",
  // Language: "en" | "hi" | "ur"
  cardLanguage:            "en",
};

/**
 * Fetch the school's configuration settings.
 * Returns: { working_days, weekend_days, session_start_month,
 *            school_start_time, school_end_time, principal_signature (URL|null) }
 */
export const fetchSchoolSettings = async (user) => {
  const res  = await safeFetch(`${BASE_URL}/SchoolSettingsServiceApi/getSettings`, {
    method:  "GET",
    headers: { ...buildHeaders(user), Accept: "application/json" },
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message ?? "Failed to load settings");
  return json.data;
};

/**
 * Save / upsert school settings.
 * payload: { working_days, weekend_days, session_start_month,
 *            school_start_time, school_end_time }
 * signatureAsset (optional): { uri, mimeType, fileName } from expo-image-picker
 */
export const saveSchoolSettings = async (user, payload, signatureAsset = null) => {
  const form = new FormData();

  form.append("working_days",        String(payload.working_days));
  form.append("weekend_days",        String(payload.weekend_days));
  form.append("session_start_month", String(payload.session_start_month));
  form.append("school_start_time",   String(payload.school_start_time));
  form.append("school_end_time",     String(payload.school_end_time));

  if (signatureAsset) {
    const uri      = signatureAsset.uri;
    const mimeType = signatureAsset.mimeType ?? "image/png";
    const ext      = mimeType.split("/")[1] ?? "png";
    form.append("principal_signature", {
      uri,
      name: `principal_signature.${ext}`,
      type: mimeType,
    });
  }

  const res  = await safeFetch(`${BASE_URL}/SchoolSettingsServiceApi/saveSettings`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    form,
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message ?? "Failed to save settings");
  return json;
};

/**
 * Fetch the school's ID card field visibility config.
 * Returns merged config object (all keys guaranteed, missing ones default to true).
 */
export const fetchIdCardConfig = async (user) => {
  const res  = await safeFetch(`${BASE_URL}/SchoolSettingsServiceApi/getIdCardConfig`, {
    method:  "GET",
    headers: { ...buildHeaders(user), Accept: "application/json" },
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message ?? "Failed to load ID card config");
  return { ...ID_CARD_CONFIG_DEFAULTS, ...json.config };
};

/**
 * Save ID card field visibility config.
 * config: object with boolean keys matching ID_CARD_CONFIG_DEFAULTS
 */
export const saveIdCardConfig = async (user, config) => {
  const form = new FormData();
  Object.entries(config).forEach(([k, v]) => {
    // String fields go as-is; boolean fields as "1"/"0" so PHP filter_var works
    form.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v ?? ""));
  });

  const res  = await safeFetch(`${BASE_URL}/SchoolSettingsServiceApi/saveIdCardConfig`, {
    method:  "POST",
    headers: buildHeaders(user),
    body:    form,
  });
  const json = await res.json();
  if (!json.status) throw new Error(json.message ?? "Failed to save ID card config");
  return json;
};
