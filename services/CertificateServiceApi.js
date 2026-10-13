/**
 * services/CertificateServiceApi.js
 * Fetches the data bundle needed to render any school certificate.
 */
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";
import { _t } from "./i18n";

const buildHeaders = (user) => ({
  Accept:         "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

/**
 * GET /CertificateApi/getCertificateData?enrollment_id=<id>
 * @returns {{ student: object, school: object }}
 */
export async function fetchCertificateData(user, enrollmentId) {
  const res = await safeFetch(
    `${BASE_URL}/CertificateApi/getCertificateData?enrollment_id=${encodeURIComponent(enrollmentId)}`,
    { method: "GET", headers: buildHeaders(user) }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false)
    throw new Error(data.message ?? _t("HTTP {status}", { status: res.status }));
  return { student: data.student, school: data.school };
}
