// services/dashboardServiceApi.js
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";

const buildHeaders = (user) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});

export const fetchDashboardMetrics = async (user) => {
  const response = await safeFetch(`${BASE_URL}/DashboardServiceApi/dashboard`, {
    headers: buildHeaders(user),
  });

  const data = await response.json() ;
  //console.log("Dashboard API response:", data);

  return data.data; // adjust based on backend
};