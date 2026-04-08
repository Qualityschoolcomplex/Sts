

// ======================================================================
// FILE: artifacts/api-server/src/app.ts
// ======================================================================

import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET || "qsc-sis-secret-2024";

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  }),
);

app.use("/api", router);

export default app;


// ======================================================================
// FILE: artifacts/api-server/src/db.ts
// ======================================================================

import Datastore from "nedb-promises";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

export const usersDb = new Datastore({ filename: path.join(DATA_DIR, "users.db"), autoload: true });
export const studentsDb = new Datastore({ filename: path.join(DATA_DIR, "students.db"), autoload: true });
export const scoreSheetsDb = new Datastore({ filename: path.join(DATA_DIR, "scoreSheets.db"), autoload: true });
export const reportsDb = new Datastore({ filename: path.join(DATA_DIR, "reports.db"), autoload: true });

usersDb.ensureIndex({ fieldName: "username", unique: true });

async function seedUsers() {
  const count = await usersDb.count({});
  if (count === 0) {
    const adminHash = await bcrypt.hash("admin123", 10);
    const staffHash = await bcrypt.hash("staff123", 10);
    await usersDb.insert([
      { username: "admin", password: adminHash, role: "admin", name: "Administrator" },
      { username: "staff1", password: staffHash, role: "staff", name: "Staff Member 1" },
    ]);
  }
}

seedUsers().catch(console.error);


// ======================================================================
// FILE: artifacts/api-server/src/routes/index.ts
// ======================================================================

import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import studentsRouter from "./students.js";
import scoreSheetsRouter from "./scoreSheets.js";
import reportsRouter from "./reports.js";
import downloadsRouter from "./downloads.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(studentsRouter);
router.use(scoreSheetsRouter);
router.use(reportsRouter);
router.use(downloadsRouter);

export default router;


// ======================================================================
// FILE: artifacts/api-server/src/routes/auth.ts
// ======================================================================

import { Router } from "express";
import bcrypt from "bcryptjs";
import { usersDb } from "../db.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }
  try {
    const user = await usersDb.findOne<{ username: string; password: string; role: string; name: string }>({ username });
    if (!user) {
      res.status(401).json({ error: "Wrong username or password" });
      return;
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      res.status(401).json({ error: "Wrong username or password" });
      return;
    }
    (req.session as any).user = { username: user.username, role: user.role, name: user.name };
    res.json({ username: user.username, role: user.role, name: user.name });
  } catch (err) {
    req.log.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.get("/me", (req, res) => {
  const user = (req.session as any).user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(user);
});

router.get("/users", async (req, res) => {
  const user = (req.session as any).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const users = await usersDb.find<{ username: string; role: string; name: string }>({}, { password: 0 });
    res.json(users);
  } catch (err) {
    req.log.error({ err }, "Get users error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users", async (req, res) => {
  const user = (req.session as any).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { username, password, role, name } = req.body as { username: string; password: string; role: string; name: string };
  if (!username || !password || !role || !name) {
    res.status(400).json({ error: "All fields required" });
    return;
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const created = await usersDb.insert({ username, password: hashed, role, name });
    res.json({ username: (created as any).username, role: (created as any).role, name: (created as any).name });
  } catch (err: any) {
    if (err.errorType === "uniqueViolated") {
      res.status(409).json({ error: "Username already exists" });
      return;
    }
    req.log.error({ err }, "Create user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/users/:username", async (req, res) => {
  const user = (req.session as any).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { username } = req.params;
  const { password, role, name } = req.body as { password?: string; role?: string; name?: string };
  const update: Record<string, string> = {};
  if (role) update.role = role;
  if (name) update.name = name;
  if (password) update.password = await bcrypt.hash(password, 10);
  try {
    await usersDb.update({ username }, { $set: update });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/users/:username", async (req, res) => {
  const user = (req.session as any).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { username } = req.params;
  if (username === "admin") {
    res.status(400).json({ error: "Cannot delete admin" });
    return;
  }
  try {
    await usersDb.remove({ username }, {});
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete user error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;


// ======================================================================
// FILE: artifacts/api-server/src/routes/students.ts
// ======================================================================

import { Router } from "express";
import { studentsDb } from "../db.js";

const router = Router();

function authRequired(req: any, res: any, next: any) {
  if (!(req.session as any).user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

router.get("/students", authRequired, async (req, res) => {
  const user = (req.session as any).user;
  try {
    const query: Record<string, string> = {};
    if (user.role === "staff") {
      query.createdBy = user.username;
    }
    const students = await studentsDb.find<any>(query).sort({ name: 1 });
    res.json(students);
  } catch (err) {
    req.log.error({ err }, "Get students error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/students", authRequired, async (req, res) => {
  const user = (req.session as any).user;
  const { name, className } = req.body as { name: string; className?: string };
  if (!name) {
    res.status(400).json({ error: "Name required" });
    return;
  }
  try {
    const student = await studentsDb.insert({
      name,
      className: className || "",
      createdBy: user.username,
      createdAt: new Date().toISOString(),
    });
    res.json(student);
  } catch (err) {
    req.log.error({ err }, "Create student error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/students/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  const { name, className } = req.body as { name?: string; className?: string };
  const update: Record<string, string> = {};
  if (name) update.name = name;
  if (className !== undefined) update.className = className;
  try {
    await studentsDb.update({ _id: id }, { $set: update });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update student error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/students/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    await studentsDb.remove({ _id: id }, {});
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete student error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;


// ======================================================================
// FILE: artifacts/api-server/src/routes/scoreSheets.ts
// ======================================================================

import { Router } from "express";
import { scoreSheetsDb } from "../db.js";

const router = Router();

function authRequired(req: any, res: any, next: any) {
  if (!(req.session as any).user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

router.get("/score-sheets", authRequired, async (req, res) => {
  const user = (req.session as any).user;
  try {
    const query: Record<string, string> = {};
    if (user.role === "staff") {
      query.createdBy = user.username;
    }
    const sheets = await scoreSheetsDb.find<any>(query).sort({ createdAt: -1 });
    res.json(sheets);
  } catch (err) {
    req.log.error({ err }, "Get score sheets error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/score-sheets", authRequired, async (req, res) => {
  const user = (req.session as any).user;
  const body = req.body as {
    subject: string;
    term: string;
    session: string;
    className: string;
    students: Array<{ name: string; scores: Record<string, number | string> }>;
  };
  if (!body.subject || !body.students) {
    res.status(400).json({ error: "Subject and students required" });
    return;
  }
  try {
    const sheet = await scoreSheetsDb.insert({
      ...body,
      createdBy: user.username,
      createdAt: new Date().toISOString(),
    });
    res.json(sheet);
  } catch (err) {
    req.log.error({ err }, "Create score sheet error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/score-sheets/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const sheet = await scoreSheetsDb.findOne<any>({ _id: id });
    if (!sheet) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(sheet);
  } catch (err) {
    req.log.error({ err }, "Get score sheet error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/score-sheets/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  try {
    await scoreSheetsDb.update({ _id: id }, { $set: body });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Update score sheet error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/score-sheets/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    await scoreSheetsDb.remove({ _id: id }, {});
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete score sheet error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;


// ======================================================================
// FILE: artifacts/api-server/src/routes/reports.ts
// ======================================================================

import { Router } from "express";
import { reportsDb } from "../db.js";

const router = Router();

function authRequired(req: any, res: any, next: any) {
  if (!(req.session as any).user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

router.get("/reports", authRequired, async (req, res) => {
  const user = (req.session as any).user;
  try {
    const query: Record<string, string> = {};
    if (user.role === "staff") {
      query.createdBy = user.username;
    }
    const reports = await reportsDb.find<any>(query).sort({ createdAt: -1 });
    res.json(reports);
  } catch (err) {
    req.log.error({ err }, "Get reports error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reports", authRequired, async (req, res) => {
  const user = (req.session as any).user;
  const body = req.body;
  try {
    const report = await reportsDb.insert({
      ...body,
      createdBy: user.username,
      createdAt: new Date().toISOString(),
    });
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Create report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const report = await reportsDb.findOne<any>({ _id: id });
    if (!report) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Get report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/reports/:id", authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    await reportsDb.remove({ _id: id }, {});
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Delete report error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;


// ======================================================================
// FILE: artifacts/school-sis/src/api.ts
// ======================================================================

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<User>("/login", { method: "POST", body: JSON.stringify({ username, password }) }),
    logout: () => request<{ success: boolean }>("/logout", { method: "POST" }),
    me: () => request<User>("/me"),
    getUsers: () => request<User[]>("/users"),
    createUser: (data: { username: string; password: string; role: string; name: string }) =>
      request<User>("/users", { method: "POST", body: JSON.stringify(data) }),
    updateUser: (username: string, data: Partial<{ password: string; role: string; name: string }>) =>
      request<{ success: boolean }>(`/users/${username}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteUser: (username: string) =>
      request<{ success: boolean }>(`/users/${username}`, { method: "DELETE" }),
  },
  students: {
    list: () => request<Student[]>("/students"),
    create: (data: { name: string; className?: string }) =>
      request<Student>("/students", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<{ name: string; className: string }>) =>
      request<{ success: boolean }>(`/students/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/students/${id}`, { method: "DELETE" }),
  },
  scoreSheets: {
    list: () => request<ScoreSheet[]>("/score-sheets"),
    get: (id: string) => request<ScoreSheet>(`/score-sheets/${id}`),
    create: (data: Omit<ScoreSheet, "_id" | "createdBy" | "createdAt">) =>
      request<ScoreSheet>("/score-sheets", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<ScoreSheet>) =>
      request<{ success: boolean }>(`/score-sheets/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/score-sheets/${id}`, { method: "DELETE" }),
  },
  reports: {
    list: () => request<Report[]>("/reports"),
    get: (id: string) => request<Report>(`/reports/${id}`),
    create: (data: Omit<Report, "_id" | "createdBy" | "createdAt">) =>
      request<Report>("/reports", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/reports/${id}`, { method: "DELETE" }),
  },
};

export interface User {
  username: string;
  role: "admin" | "staff";
  name: string;
}

export interface Student {
  _id: string;
  name: string;
  className: string;
  createdBy: string;
  createdAt: string;
}

export interface ScoreEntry {
  name: string;
  scores: {
    ca1?: number;
    ca2?: number;
    ca3?: number;
    exam?: number;
    total?: number;
    grade?: string;
    remark?: string;
  };
}

export interface ScoreSheet {
  _id: string;
  subject: string;
  term: string;
  session: string;
  className: string;
  students: ScoreEntry[];
  createdBy: string;
  createdAt: string;
}

export interface SubjectScore {
  subject: string;
  ca1: number;
  ca2: number;
  ca3: number;
  exam: number;
  total: number;
  grade: string;
  remark: string;
}

export interface Report {
  _id: string;
  studentName: string;
  className: string;
  term: string;
  session: string;
  position?: string;
  subjects: SubjectScore[];
  attendance?: { present: number; total: number };
  teacherRemark?: string;
  principalRemark?: string;
  nextTermBegins?: string;
  createdBy: string;
  createdAt: string;
}
