export function getApiUrl(path: string) {
  return path;
}

const SYNC_KEYS = [
  "qsc_users",
  "qsc_reports",
  "qsc_report_template",
  "qsc_school_logo",
  "qsc_score_sheets",
  "qsc_student_names",
];

const API_BASE = "/api/storage";

export async function syncFromServer() {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return;
    const data: Record<string, string> = await res.json();
    for (const key of SYNC_KEYS) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        localStorage.setItem(key, data[key]);
      } else {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // offline or error — keep localStorage as is
  }
}

export function syncToServer(key: string, value: string) {
  fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).catch(() => {});
}

export function deleteFromServer(key: string) {
  fetch(`${API_BASE}/${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {});
}

function lsGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
    syncToServer(key, val);
  } catch {}
}

// ── users ──────────────────────────────────────────────
export interface User {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: "admin" | "staff";
}

export function getUsers(): User[] {
  try {
    return JSON.parse(lsGet("qsc_users") || "[]");
  } catch {
    return [];
  }
}

export function saveUsers(users: User[]) {
  lsSet("qsc_users", JSON.stringify(users));
}

// ── current user ────────────────────────────────────────
export function getCurrentUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem("qsc_current_user") || "null");
  } catch {
    return null;
  }
}

export function setCurrentUser(u: User | null) {
  if (u) localStorage.setItem("qsc_current_user", JSON.stringify(u));
  else localStorage.removeItem("qsc_current_user");
}

// ── score sheets ────────────────────────────────────────
export interface ScoreRow {
  no: number;
  studentName: string;
  classScore: string;
  exam100: string;
}

export interface ScoreSheet {
  id: string;
  title: string;
  subject: string;
  class: string;
  term: string;
  academicYear: string;
  rows: ScoreRow[];
  status: "draft" | "submitted" | "approved";
  staffUsername: string;
  staffName: string;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
}

export function getScoreSheets(): ScoreSheet[] {
  try {
    return JSON.parse(lsGet("qsc_score_sheets") || "[]");
  } catch {
    return [];
  }
}

export function saveScoreSheets(sheets: ScoreSheet[]) {
  lsSet("qsc_score_sheets", JSON.stringify(sheets));
}

// ── student names ───────────────────────────────────────
export function getStudentNames(): string[] {
  try {
    return JSON.parse(lsGet("qsc_student_names") || "[]");
  } catch {
    return [];
  }
}

export function saveStudentNames(names: string[]) {
  lsSet("qsc_student_names", JSON.stringify(names));
}

// ── report template ─────────────────────────────────────
export interface ReportTemplate {
  schoolName: string;
  schoolSub: string;
  address: string;
  phone: string;
  email: string;
  motto: string;
}

export const DEFAULT_TEMPLATE: ReportTemplate = {
  schoolName: "QUALITY SCHOOL COMPLEX",
  schoolSub: "NURSERY, PRIMARY & JHS",
  address: "P. O. Box 123, Accra, Ghana",
  phone: "0200000000",
  email: "info@qualityschool.edu.gh",
  motto: "Excellence in Education",
};

export function getReportTemplate(): ReportTemplate {
  try {
    const s = lsGet("qsc_report_template");
    return s ? { ...DEFAULT_TEMPLATE, ...JSON.parse(s) } : DEFAULT_TEMPLATE;
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

export function saveReportTemplate(t: ReportTemplate) {
  lsSet("qsc_report_template", JSON.stringify(t));
}

// ── school logo ─────────────────────────────────────────
export function getSchoolLogo(): string {
  return lsGet("qsc_school_logo") || "";
}

export function saveSchoolLogo(b64: string) {
  lsSet("qsc_school_logo", b64);
}

export function removeSchoolLogo() {
  try {
    localStorage.removeItem("qsc_school_logo");
    deleteFromServer("qsc_school_logo");
  } catch {}
}

// ── reports (generated) ─────────────────────────────────
export interface SubjectResult {
  subject: string;
  classScore: number;
  exam100: number;
  exam70: number;
  total: number;
  position: string;
}

export interface Report {
  id: string;
  studentName: string;
  studentClass: string;
  term: string;
  academicYear: string;
  totalStudents: string;
  attendance: string;
  nextTermBegins: string;
  houseOrStream: string;
  subjects: SubjectResult[];
  classTeacherRemarks: string;
  headTeacherRemarks: string;
  classTeacherSignature: string;
  headTeacherSignature: string;
  createdAt: string;
  submittedByAdmin: boolean;
  submittedAt: string | null;
}

export function getReports(): Report[] {
  try {
    return JSON.parse(lsGet("qsc_reports") || "[]");
  } catch {
    return [];
  }
}

export function saveReports(reports: Report[]) {
  lsSet("qsc_reports", JSON.stringify(reports));
}

// ── utilities ────────────────────────────────────────────
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function calcExam70(exam100: number) {
  return Math.round((exam100 / 100) * 70 * 10) / 10;
}

export function calcTotal(classScore: number, exam70: number) {
  return Math.round((classScore + exam70) * 10) / 10;
}

export function calcGrade(total: number): string {
  if (total >= 80) return "A1";
  if (total >= 70) return "B2";
  if (total >= 65) return "B3";
  if (total >= 60) return "C4";
  if (total >= 55) return "C5";
  if (total >= 50) return "C6";
  if (total >= 45) return "D7";
  if (total >= 40) return "E8";
  return "F9";
}
