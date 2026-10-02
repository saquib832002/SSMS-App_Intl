//const BASE_URL = "http://192.168.4.90/ssms5/SetupServiceApi";
import { BASE_URL } from "../Environment/EnvironmentConfig";
import { safeFetch } from "./apiInterceptor";

const buildHeaders = (user) => ({
  Accept:         "application/json",
  "Content-Type": "application/json",
  ssmsUserName:   user?.ssmsUserName   ?? "",
  ssmsUserRole:   user?.ssmsUserRole   ?? user?.role ?? "",
  ssmsClientCode: user?.ssmsClientCode ?? "",
  Authorization:  user?.token ? `Bearer ${user.token}` : "",
});


export const fetchBranches = async (user) => {

  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/getBranches`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json();
  return data;
};

export const createBranch = async (user, payload) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/createBranch`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });

  return response.json();
};

export const updateBranch = async (user, branchId, payload) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/updateBranch/${branchId}`, {
    method: "PUT",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });
  return response.json();
};

export const deleteBranch = async (user, branchId) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/deleteBranch/${branchId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  });

  return response.json();
};


// ============================================
// Classes and other setup APIs can be implemented similarly, just change the endpoint and payload as needed.
// ============================================

export const fetchClasses = async (user) => {

  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/getClasses`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json();
  return data.data;
};

export const createClass = async (user, payload) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/createClass`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  return data.data;
};

export const updateClass = async (user, classId, payload) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/updateClass/${classId}`, {
    method: "PUT",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  return data.data;
};

export const deleteClass = async (user, classId) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/deleteClass/${classId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  });

  const data = await response.json();
  return data.data;
};



// ============================================
// Sections and other setup APIs can be implemented similarly, just change the endpoint and payload as needed.
// ============================================

export const fetchSections = async (user, classId) => {
  const params = classId ? `?class_id=${classId}` : '';
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/getSections${params}`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json();
  return data;
};


export const createSection = async (user, payload) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/createSection`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  return data;
};

export const updateSection = async (sectionId, user, payload) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/updateSection/${sectionId}`, {
    method: "PUT",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  return data;
};

export const deleteSection = async (sectionId, user) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/deleteSection/${sectionId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  });

  const data = await response.json();
  return data;
};


export const fetchSessions = async (user) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/getSessions`, {
    method: "GET",
    headers: buildHeaders(user),
  });
  const data = await response.json();
  return data;
};

export const createSession = async (user, payload) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/createSession`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  return data;
};

export const updateSession = async (user, sessionId, payload) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/updateSession/${sessionId}`, {
    method: "PUT",
    headers: buildHeaders(user),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  return data;
};

export const deleteSession = async (user, sessionId) => {
  const response = await safeFetch(`${BASE_URL}/SetupServiceApi/deleteSession/${sessionId}`, {
    method: "DELETE",
    headers: buildHeaders(user),
  });

  const data = await response.json();
  return data;
};