// ============================================================
// FILE: artifacts/api-server/src/app.ts
// ============================================================

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;


// ============================================================
// FILE: artifacts/api-server/src/index.ts
// ============================================================

import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});


// ============================================================
// FILE: artifacts/api-server/src/lib/logger.ts
// ============================================================

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});


// ============================================================
// FILE: artifacts/api-server/src/routes/downloads.ts
// ============================================================

import { Router, type IRouter } from "express";
import fs from "node:fs";
import path from "node:path";

const router: IRouter = Router();

router.get("/downloads/combined.ts", (_req, res, next) => {
  const candidates = [
    path.resolve(
      process.cwd(),
      "../quality-school-sis/public/downloads/combined/combined.ts",
    ),
    path.resolve(
      process.cwd(),
      "artifacts/quality-school-sis/public/downloads/combined/combined.ts",
    ),
  ];

  const filePath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!filePath) {
    res.status(404).json({ error: "combined.ts was not found" });
    return;
  }

  res.download(filePath, "combined.ts", (err) => {
    if (err && !res.headersSent) {
      next(err);
    }
  });
});

export default router;

// ============================================================
// FILE: artifacts/api-server/src/routes/health.ts
// ============================================================

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;


// ============================================================
// FILE: artifacts/api-server/src/routes/index.ts
// ============================================================

import { Router, type IRouter } from "express";
import downloadsRouter from "./downloads";
import healthRouter from "./health";
import sisRouter from "./sis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(downloadsRouter);
router.use(sisRouter);

export default router;


// ============================================================
// FILE: artifacts/api-server/src/routes/sis.ts
// ============================================================

import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  CreateReportBody,
  CreateScoreSheetBody,
  CreateStudentNameBody,
  CreateUserBody,
  DeleteReportParams,
  DeleteScoreSheetParams,
  DeleteStudentNameParams,
  DeleteUserParams,
  LoginUserBody,
  UpdateReportBody,
  UpdateReportParams,
  UpdateScoreSheetBody,
  UpdateScoreSheetParams,
  UpdateUserBody,
  UpdateUserParams,
} from "@workspace/api-zod";

const router: Router = Router();

const STATE_KEY = "main";

type Role = "admin" | "staff";
type User = {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: Role;
};
type StudentName = { id: string; name: string; createdBy: string };
type ScoreRow = {
  studentName: string;
  ca: number;
  exam: number;
  total: number;
  position: string;
};
type ScoreSheet = {
  id: string;
  title: string;
  subject: string;
  className: string;
  term: string;
  session: string;
  staffId: string;
  status: "draft" | "submitted";
  rows: ScoreRow[];
  createdAt: string;
};
type ReportSubject = {
  subject: string;
  ca: number;
  exam: number;
  total: number;
  grade: string;
  remark: string;
};
type Report = {
  id: string;
  studentName: string;
  className: string;
  term: string;
  session: string;
  position: string;
  attendance: string;
  nextTermBegins: string;
  teacherComment: string;
  principalComment: string;
  createdBy: string;
  submittedByRole: Role;
  status: "draft" | "submitted";
  subjects: ReportSubject[];
  createdAt: string;
};
type AppState = {
  school: {
    title: string;
    subtitle: string;
    address: string;
    motto: string;
  };
  users: User[];
  studentNames: StudentName[];
  scoreSheets: ScoreSheet[];
  reports: Report[];
};

function defaultState(): AppState {
  return {
    school: {
      title: "QUALITY SCHOOL COMPLEX",
      subtitle: "NURSERY, PRIMARY AND SECONDARY SCHOOL",
      address: "P.O. BOX 000, QUALITY SCHOOL COMPLEX",
      motto: "Knowledge, Character and Excellence",
    },
    users: [
      {
        id: "admin-default",
        username: "admin",
        password: "admin123",
        displayName: "School Administrator",
        role: "admin",
      },
      {
        id: "staff-default",
        username: "staff",
        password: "staff123",
        displayName: "Class Teacher",
        role: "staff",
      },
    ],
    studentNames: [
      { id: "student-1", name: "Ada Johnson", createdBy: "staff-default" },
      { id: "student-2", name: "Michael Okoro", createdBy: "staff-default" },
      { id: "student-3", name: "Blessing Musa", createdBy: "staff-default" },
    ],
    scoreSheets: [],
    reports: [],
  };
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function normaliseRows(rows: ScoreRow[]): ScoreRow[] {
  const withTotals = rows.map((row) => ({
    ...row,
    ca: Number(row.ca) || 0,
    exam: Number(row.exam) || 0,
    total: (Number(row.ca) || 0) + (Number(row.exam) || 0),
    position: "",
  }));
  const sorted = [...withTotals].sort((a, b) => b.total - a.total);
  const ranks = new Map<string, string>();
  sorted.forEach((row, index) => {
    ranks.set(`${row.studentName}-${row.total}-${index}`, ordinal(index + 1));
  });
  const rankQueue = new Map<string, string[]>();
  sorted.forEach((row, index) => {
    const key = `${row.studentName}-${row.total}`;
    const values = rankQueue.get(key) ?? [];
    values.push(ranks.get(`${row.studentName}-${row.total}-${index}`) ?? ordinal(index + 1));
    rankQueue.set(key, values);
  });
  return withTotals.map((row) => {
    const key = `${row.studentName}-${row.total}`;
    const values = rankQueue.get(key) ?? [];
    const position = values.shift() ?? "";
    rankQueue.set(key, values);
    return { ...row, position };
  });
}

async function ensureStateTable() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS sis_state (key TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  );
}

async function getState(): Promise<AppState> {
  await ensureStateTable();
  const result = await pool.query("SELECT data FROM sis_state WHERE key = $1", [STATE_KEY]);
  if (result.rows[0]?.data) return result.rows[0].data as AppState;
  const state = defaultState();
  await saveState(state);
  return state;
}

async function saveState(state: AppState): Promise<AppState> {
  await ensureStateTable();
  await pool.query(
    "INSERT INTO sis_state (key, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
    [STATE_KEY, JSON.stringify(state)],
  );
  return state;
}

function sendError(res: Response, status: number, message: string) {
  res.status(status).json({ message });
}

router.get("/sis/bootstrap", async (_req, res, next) => {
  try {
    res.json(await getState());
  } catch (err) {
    next(err);
  }
});

router.post("/sis/login", async (req, res, next) => {
  try {
    const body = LoginUserBody.parse(req.body);
    const state = await getState();
    const user = state.users.find(
      (candidate) =>
        candidate.username.trim().toLowerCase() === body.username.trim().toLowerCase() &&
        candidate.password === body.password,
    );
    if (!user) {
      res.json({ ok: false, message: "Wrong username or password", user: null });
      return;
    }
    res.json({ ok: true, message: "Login successful", user });
  } catch (err) {
    next(err);
  }
});

router.post("/sis/users", async (req, res, next) => {
  try {
    const body = CreateUserBody.parse(req.body);
    const state = await getState();
    const exists = state.users.some(
      (user) => user.username.trim().toLowerCase() === body.username.trim().toLowerCase(),
    );
    if (exists) {
      sendError(res, 400, "Username already exists");
      return;
    }
    state.users.push({ id: crypto.randomUUID(), ...body });
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.put("/sis/users/:id", async (req, res, next) => {
  try {
    const params = UpdateUserParams.parse(req.params);
    const body = UpdateUserBody.parse(req.body);
    const state = await getState();
    const duplicate = state.users.some(
      (user) =>
        user.id !== params.id &&
        user.username.trim().toLowerCase() === body.username.trim().toLowerCase(),
    );
    if (duplicate) {
      sendError(res, 400, "Username already exists");
      return;
    }
    const index = state.users.findIndex((user) => user.id === params.id);
    if (index === -1) {
      sendError(res, 404, "User not found");
      return;
    }
    state.users[index] = { id: params.id, ...body };
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.delete("/sis/users/:id", async (req, res, next) => {
  try {
    const params = DeleteUserParams.parse(req.params);
    const state = await getState();
    const user = state.users.find((candidate) => candidate.id === params.id);
    if (!user) {
      sendError(res, 404, "User not found");
      return;
    }
    if (user.role === "admin" && state.users.filter((candidate) => candidate.role === "admin").length === 1) {
      sendError(res, 400, "At least one admin account is required");
      return;
    }
    state.users = state.users.filter((candidate) => candidate.id !== params.id);
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.post("/sis/student-names", async (req, res, next) => {
  try {
    const body = CreateStudentNameBody.parse(req.body);
    const state = await getState();
    const exists = state.studentNames.some(
      (student) => student.name.trim().toLowerCase() === body.name.trim().toLowerCase(),
    );
    if (!exists) state.studentNames.push({ id: crypto.randomUUID(), ...body });
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.delete("/sis/student-names/:id", async (req, res, next) => {
  try {
    const params = DeleteStudentNameParams.parse(req.params);
    const state = await getState();
    state.studentNames = state.studentNames.filter((student) => student.id !== params.id);
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.post("/sis/score-sheets", async (req, res, next) => {
  try {
    const body = CreateScoreSheetBody.parse(req.body);
    const state = await getState();
    state.scoreSheets.push({
      id: crypto.randomUUID(),
      ...body,
      rows: normaliseRows(body.rows),
      createdAt: new Date().toISOString(),
    });
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.put("/sis/score-sheets/:id", async (req, res, next) => {
  try {
    const params = UpdateScoreSheetParams.parse(req.params);
    const body = UpdateScoreSheetBody.parse(req.body);
    const state = await getState();
    const index = state.scoreSheets.findIndex((sheet) => sheet.id === params.id);
    if (index === -1) {
      sendError(res, 404, "Score sheet not found");
      return;
    }
    state.scoreSheets[index] = {
      ...state.scoreSheets[index],
      ...body,
      rows: normaliseRows(body.rows),
    };
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.delete("/sis/score-sheets/:id", async (req, res, next) => {
  try {
    const params = DeleteScoreSheetParams.parse(req.params);
    const state = await getState();
    state.scoreSheets = state.scoreSheets.filter((sheet) => sheet.id !== params.id);
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.post("/sis/reports", async (req, res, next) => {
  try {
    const body = CreateReportBody.parse(req.body);
    const state = await getState();
    state.reports.push({ id: crypto.randomUUID(), ...body, createdAt: new Date().toISOString() });
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.put("/sis/reports/:id", async (req, res, next) => {
  try {
    const params = UpdateReportParams.parse(req.params);
    const body = UpdateReportBody.parse(req.body);
    const state = await getState();
    const index = state.reports.findIndex((report) => report.id === params.id);
    if (index === -1) {
      sendError(res, 404, "Report not found");
      return;
    }
    state.reports[index] = { ...state.reports[index], ...body };
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

router.delete("/sis/reports/:id", async (req, res, next) => {
  try {
    const params = DeleteReportParams.parse(req.params);
    const state = await getState();
    state.reports = state.reports.filter((report) => report.id !== params.id);
    res.json(await saveState(state));
  } catch (err) {
    next(err);
  }
});

export default router;


// ============================================================
// FILE: artifacts/quality-school-sis/src/App.tsx
// ============================================================

import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Login from "@/pages/login";
import AdminDashboard from "@/pages/admin";
import StaffDashboard from "@/pages/staff";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Login} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/staff" component={StaffDashboard} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/admin/reports-list.tsx
// ============================================================

import { Report } from "@workspace/api-client-react/src/generated/api.schemas";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function ReportsList({ reports }: { reports: Report[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Reports</h2>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Term/Session</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map(report => (
              <TableRow key={report.id}>
                <TableCell className="font-medium">{report.studentName}</TableCell>
                <TableCell>{report.className}</TableCell>
                <TableCell>{report.term} / {report.session}</TableCell>
                <TableCell>{report.position}</TableCell>
                <TableCell>
                  <Badge variant={report.status === 'submitted' ? 'default' : 'secondary'}>
                    {report.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{new Date(report.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
            {reports.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No reports found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/admin/score-sheets-list.tsx
// ============================================================

import { ScoreSheet } from "@workspace/api-client-react/src/generated/api.schemas";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function ScoreSheetsList({ scoreSheets }: { scoreSheets: ScoreSheet[] }) {
  // Only show submitted sheets to admin
  const submittedSheets = scoreSheets.filter(s => s.status === "submitted");

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Submitted Score Sheets</h2>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Term/Session</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submittedSheets.map(sheet => (
              <TableRow key={sheet.id}>
                <TableCell className="font-medium">{sheet.title}</TableCell>
                <TableCell>{sheet.className}</TableCell>
                <TableCell>{sheet.subject}</TableCell>
                <TableCell>{sheet.term} / {sheet.session}</TableCell>
                <TableCell><Badge variant="outline">{sheet.rows.length} students</Badge></TableCell>
                <TableCell className="text-muted-foreground">{new Date(sheet.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
            {submittedSheets.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No submitted score sheets found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/admin/user-management.tsx
// ============================================================

import { useState } from "react";
import { User, Role } from "@workspace/api-client-react/src/generated/api.schemas";
import { useCreateUser, useUpdateUser, useDeleteUser, getGetBootstrapQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Edit2, Trash2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function UserManagement({ users }: { users: User[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isOpen, setIsOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("staff");

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBootstrapQueryKey() });
        toast({ title: "User created" });
        setIsOpen(false);
        resetForm();
      }
    }
  });

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBootstrapQueryKey() });
        toast({ title: "User updated" });
        setIsOpen(false);
        resetForm();
      }
    }
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBootstrapQueryKey() });
        toast({ title: "User deleted" });
      }
    }
  });

  const resetForm = () => {
    setEditingUser(null);
    setUsername("");
    setPassword("");
    setDisplayName("");
    setRole("staff");
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setUsername(user.username);
    setPassword(""); // Keep blank to avoid showing hash
    setDisplayName(user.displayName);
    setRole(user.role);
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      updateMutation.mutate({
        id: editingUser.id,
        data: { username, password: password || editingUser.password, displayName, role }
      });
    } else {
      createMutation.mutate({
        data: { username, password, displayName, role }
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">System Users</h2>
        <Dialog open={isOpen} onOpenChange={(open) => {
          if (!open) resetForm();
          setIsOpen(open);
        }}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}><Plus className="h-4 w-4 mr-2"/> Add User</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingUser ? "Edit User" : "Create New User"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input value={displayName} onChange={e => setDisplayName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Username</Label>
                <Input value={username} onChange={e => setUsername(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Password {editingUser && <span className="text-xs text-muted-foreground">(leave blank to keep current)</span>}</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required={!editingUser} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(val: Role) => setRole(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}
                Save User
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(u => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.displayName}</TableCell>
                <TableCell>{u.username}</TableCell>
                <TableCell>
                  <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(u)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      if (confirm("Are you sure you want to delete this user?")) {
                        deleteMutation.mutate({ id: u.id });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/layout.tsx
// ============================================================

import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuthStore } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LogOut, LayoutDashboard, Users, FileText, BookOpen, GraduationCap } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuthStore();

  if (!user) {
    return <>{children}</>;
  }

  const isAdmin = user.role === "admin";

  const navItems = isAdmin
    ? [
        { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
      ]
    : [
        { href: "/staff", label: "Dashboard", icon: LayoutDashboard },
      ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2 font-bold text-xl text-sidebar-primary">
            <GraduationCap className="h-6 w-6" />
            <span>Quality SIS</span>
          </div>
          <div className="mt-1 text-sm text-sidebar-foreground/70">
            {isAdmin ? "Administrator" : "Staff"} Portal
          </div>
        </div>
        
        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-1 px-4">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                    location === item.href
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                      : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </Link>
            ))}
          </nav>
        </ScrollArea>

        <div className="p-4 border-t border-sidebar-border">
          <div className="mb-4 px-2">
            <div className="text-sm font-medium">{user.displayName}</div>
            <div className="text-xs text-sidebar-foreground/60">{user.username}</div>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start text-destructive hover:text-destructive border-sidebar-border bg-sidebar-accent/50"
            onClick={() => {
              logout();
              window.location.href = "/";
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center px-6 border-b bg-card">
          <h1 className="font-semibold text-lg">
            {location === "/admin" ? "Admin Dashboard" : location === "/staff" ? "Staff Dashboard" : "Dashboard"}
          </h1>
        </header>
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/staff/report-generator.tsx
// ============================================================

import { useState } from "react";
import { Report, ScoreSheet, StudentName, SchoolInfo } from "@workspace/api-client-react/src/generated/api.schemas";
import { useCreateReport, useUpdateReport, useDeleteReport, getGetBootstrapQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Eye, Edit2, Trash2, Import, Save, Send } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export function ReportGenerator({ 
  reports, scoreSheets, studentNames, schoolInfo 
}: { 
  reports: Report[], scoreSheets: ScoreSheet[], studentNames: StudentName[], schoolInfo: SchoolInfo 
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuthStore();

  const [isOpen, setIsOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<Report | null>(null);

  // Form State
  const [studentName, setStudentName] = useState("");
  const [className, setClassName] = useState("");
  const [term, setTerm] = useState("");
  const [session, setSession] = useState("");
  const [position, setPosition] = useState("");
  const [attendance, setAttendance] = useState("");
  const [nextTermBegins, setNextTermBegins] = useState("");
  const [teacherComment, setTeacherComment] = useState("");
  const [principalComment, setPrincipalComment] = useState("");
  const [subjects, setSubjects] = useState<any[]>([]);

  const visibleReports = reports.filter(r =>
    user?.role === "admin" ||
    r.createdBy === user?.id ||
    (r.submittedByRole === "admin" && r.status === "submitted")
  );

  const createMutation = useCreateReport({
    mutation: { onSuccess: () => handleSuccess("Report created") }
  });

  const updateMutation = useUpdateReport({
    mutation: { onSuccess: () => handleSuccess("Report updated") }
  });

  const deleteMutation = useDeleteReport({
    mutation: { onSuccess: () => handleSuccess("Report deleted") }
  });

  const handleSuccess = (msg: string) => {
    queryClient.invalidateQueries({ queryKey: getGetBootstrapQueryKey() });
    toast({ title: msg });
    setIsOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setEditingReport(null);
    setStudentName("");
    setClassName("");
    setTerm("");
    setSession("");
    setPosition("");
    setAttendance("");
    setNextTermBegins("");
    setTeacherComment("");
    setPrincipalComment("");
    setSubjects([]);
  };

  const importFromScoreSheets = () => {
    if (!studentName) {
      toast({ title: "Select a student first", variant: "destructive" });
      return;
    }
    
    const adminSubmittedReport = reports.find(r =>
      r.studentName === studentName &&
      r.submittedByRole === "admin" &&
      r.status === "submitted"
    );

    if (adminSubmittedReport) {
      setClassName(adminSubmittedReport.className);
      setTerm(adminSubmittedReport.term);
      setSession(adminSubmittedReport.session);
      setPosition(adminSubmittedReport.position);
      setAttendance(adminSubmittedReport.attendance);
      setNextTermBegins(adminSubmittedReport.nextTermBegins);
      setTeacherComment(adminSubmittedReport.teacherComment);
      setPrincipalComment(adminSubmittedReport.principalComment);
      setSubjects(adminSubmittedReport.subjects);
      toast({ title: "Imported submitted admin report" });
      return;
    }

    const relevantSheets = scoreSheets.filter(s => s.status === 'submitted');
    const importedSubjects: any[] = [];
    
    relevantSheets.forEach(sheet => {
      const studentRow = sheet.rows.find(r => r.studentName === studentName);
      if (studentRow) {
        importedSubjects.push({
          subject: sheet.subject,
          ca: studentRow.ca,
          exam: studentRow.exam,
          total: studentRow.total,
          grade: "N/A",
          remark: studentRow.total >= 70 ? "Excellent" : studentRow.total >= 50 ? "Good" : "Pass"
        });
      }
    });

    if (importedSubjects.length > 0) {
      setSubjects(importedSubjects);
      // Auto-fill some fields from the first sheet
      const firstSheet = relevantSheets.find(s => s.rows.some(r => r.studentName === studentName));
      if (firstSheet) {
        if (!className) setClassName(firstSheet.className);
        if (!term) setTerm(firstSheet.term);
        if (!session) setSession(firstSheet.session);
        const row = firstSheet.rows.find(r => r.studentName === studentName);
        if (row && !position) setPosition(row.position);
      }
      toast({ title: `Imported ${importedSubjects.length} subjects` });
    } else {
      toast({ title: "No records found for this student", variant: "destructive" });
    }
  };

  const saveReport = (status: "draft" | "submitted") => {
    if (!user) return;
    const data = {
      studentName, className, term, session, position, attendance,
      nextTermBegins, teacherComment, principalComment,
      subjects: subjects.map(s => ({ ...s, grade: "N/A" })),
      createdBy: user.id,
      submittedByRole: user.role,
      status
    };

    if (editingReport) {
      updateMutation.mutate({ id: editingReport.id, data });
    } else {
      createMutation.mutate({ data });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Report Cards</h2>
        <Dialog open={isOpen} onOpenChange={(open) => {
          if (!open) resetForm();
          setIsOpen(open);
        }}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}><Plus className="h-4 w-4 mr-2"/> Generate Report</Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Generate Report Card</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto py-4 space-y-6">
              
              <div className="flex gap-2 items-end bg-muted/50 p-4 rounded-md border">
                <div className="space-y-2 flex-1">
                  <Label>Select Student to Import</Label>
                  <Select value={studentName} onValueChange={setStudentName}>
                    <SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger>
                    <SelectContent>
                      {studentNames.map(sn => <SelectItem key={sn.id} value={sn.name}>{sn.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={importFromScoreSheets} variant="secondary">
                  <Import className="h-4 w-4 mr-2"/> Import Data
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2"><Label>Class</Label><Input value={className} onChange={e=>setClassName(e.target.value)}/></div>
                <div className="space-y-2"><Label>Term</Label><Input value={term} onChange={e=>setTerm(e.target.value)}/></div>
                <div className="space-y-2"><Label>Session</Label><Input value={session} onChange={e=>setSession(e.target.value)}/></div>
                <div className="space-y-2"><Label>Position</Label><Input value={position} onChange={e=>setPosition(e.target.value)}/></div>
                <div className="space-y-2"><Label>Attendance</Label><Input value={attendance} onChange={e=>setAttendance(e.target.value)}/></div>
                <div className="space-y-2"><Label>Next Term Begins</Label><Input value={nextTermBegins} onChange={e=>setNextTermBegins(e.target.value)} type="date"/></div>
              </div>

              <div className="space-y-2">
                <Label>Subjects & Scores</Label>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>CA</TableHead>
                        <TableHead>Exam</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Remark</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subjects.map((sub, idx) => (
                        <TableRow key={idx}>
                          <TableCell><Input value={sub.subject} onChange={e => {const n=[...subjects]; n[idx].subject=e.target.value; setSubjects(n)}}/></TableCell>
                          <TableCell><Input type="number" value={sub.ca} onChange={e => {const n=[...subjects]; n[idx].ca=Number(e.target.value); n[idx].total=n[idx].ca+n[idx].exam; setSubjects(n)}}/></TableCell>
                          <TableCell><Input type="number" value={sub.exam} onChange={e => {const n=[...subjects]; n[idx].exam=Number(e.target.value); n[idx].total=n[idx].ca+n[idx].exam; setSubjects(n)}}/></TableCell>
                          <TableCell><span className="px-3 font-medium">{sub.total}</span></TableCell>
                          <TableCell><Input value={sub.remark} onChange={e => {const n=[...subjects]; n[idx].remark=e.target.value; setSubjects(n)}}/></TableCell>
                          <TableCell><Button variant="ghost" size="icon" onClick={() => setSubjects(subjects.filter((_,i)=>i!==idx))}><Trash2 className="h-4 w-4 text-destructive"/></Button></TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Button variant="ghost" size="sm" onClick={() => setSubjects([...subjects, {subject:"", ca:0, exam:0, total:0, remark:""}])}>
                            <Plus className="h-4 w-4 mr-2"/> Add Subject
                          </Button>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Class Teacher's Comment</Label>
                  <Textarea value={teacherComment} onChange={e=>setTeacherComment(e.target.value)} rows={3}/>
                </div>
                <div className="space-y-2">
                  <Label>Principal's Comment</Label>
                  <Textarea value={principalComment} onChange={e=>setPrincipalComment(e.target.value)} rows={3}/>
                </div>
              </div>

            </div>
            
            <div className="flex justify-end gap-2 pt-4 border-t mt-auto">
              <Button variant="outline" onClick={() => saveReport("draft")}>
                <Save className="h-4 w-4 mr-2" /> Save Draft
              </Button>
              <Button onClick={() => saveReport("submitted")}>
                <Send className="h-4 w-4 mr-2" /> Submit
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Term</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleReports.map(report => (
              <TableRow key={report.id}>
                <TableCell className="font-medium">{report.studentName}</TableCell>
                <TableCell>{report.className}</TableCell>
                <TableCell>{report.term} / {report.session}</TableCell>
                <TableCell>{report.position}</TableCell>
                <TableCell>
                  <Badge variant={report.status === 'submitted' ? 'default' : 'secondary'}>
                    {report.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon"><Eye className="h-4 w-4"/></Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-[210mm] max-h-[297mm] p-8 overflow-auto bg-white text-black">
                      <div className="space-y-6">
                        <div className="text-center border-b-2 border-black pb-4">
                          <h1 className="text-3xl font-bold text-blue-900">{schoolInfo?.title || "QUALITY SCHOOL COMPLEX"}</h1>
                          <p className="font-medium italic">{schoolInfo?.motto || "Knowledge is Power"}</p>
                          <p className="text-sm">{schoolInfo?.address || "123 Education Way, City"}</p>
                          <h2 className="text-xl font-bold mt-4">STUDENT TERMINAL REPORT</h2>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm font-medium border p-4 bg-slate-50">
                          <div>Name: <span className="font-bold border-b border-dotted border-black px-2">{report.studentName}</span></div>
                          <div>Class: <span className="font-bold border-b border-dotted border-black px-2">{report.className}</span></div>
                          <div>Term: <span className="font-bold border-b border-dotted border-black px-2">{report.term}</span></div>
                          <div>Session: <span className="font-bold border-b border-dotted border-black px-2">{report.session}</span></div>
                          <div>Position: <span className="font-bold border-b border-dotted border-black px-2">{report.position}</span></div>
                          <div>Attendance: <span className="font-bold border-b border-dotted border-black px-2">{report.attendance}</span></div>
                        </div>

                        <Table className="border border-black">
                          <TableHeader>
                            <TableRow className="border-b border-black hover:bg-transparent">
                              <TableHead className="border-r border-black font-bold text-black w-[40%]">SUBJECTS</TableHead>
                              <TableHead className="border-r border-black font-bold text-black text-center">CA (40%)</TableHead>
                              <TableHead className="border-r border-black font-bold text-black text-center">EXAM (60%)</TableHead>
                              <TableHead className="border-r border-black font-bold text-black text-center">TOTAL</TableHead>
                              <TableHead className="font-bold text-black text-center">REMARKS</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.subjects.map((sub, i) => (
                              <TableRow key={i} className="border-b border-black hover:bg-transparent">
                                <TableCell className="border-r border-black font-medium">{sub.subject}</TableCell>
                                <TableCell className="border-r border-black text-center">{sub.ca}</TableCell>
                                <TableCell className="border-r border-black text-center">{sub.exam}</TableCell>
                                <TableCell className="border-r border-black text-center font-bold">{sub.total}</TableCell>
                                <TableCell className="text-center">{sub.remark}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>

                        <div className="space-y-4 pt-4 text-sm">
                          <div className="flex gap-4">
                            <span className="font-bold whitespace-nowrap">Class Teacher's Comment:</span>
                            <span className="flex-1 border-b border-dotted border-black">{report.teacherComment}</span>
                          </div>
                          <div className="flex gap-4">
                            <span className="font-bold whitespace-nowrap">Principal's Comment:</span>
                            <span className="flex-1 border-b border-dotted border-black">{report.principalComment}</span>
                          </div>
                          <div className="flex gap-4 items-center">
                            <span className="font-bold">Next Term Begins:</span>
                            <span className="border-b border-dotted border-black px-4">{report.nextTermBegins}</span>
                          </div>
                          <div className="flex justify-between pt-12">
                            <div className="border-t border-black w-48 text-center font-bold">Class Teacher Signature</div>
                            <div className="border-t border-black w-48 text-center font-bold">Principal Signature</div>
                          </div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {user?.role === 'admin' || report.status === 'draft' ? (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-destructive"
                      onClick={() => {
                        if (confirm("Delete this report?")) {
                          deleteMutation.mutate({ id: report.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {visibleReports.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No reports found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/staff/score-sheet-manager.tsx
// ============================================================

import { useState } from "react";
import { ScoreSheet, ScoreRow, StudentName } from "@workspace/api-client-react/src/generated/api.schemas";
import { useCreateScoreSheet, useUpdateScoreSheet, useDeleteScoreSheet, getGetBootstrapQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getOrdinalSuffix } from "@/lib/utils-ext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Edit2, Trash2, Loader2, Save, Send, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ScoreSheetManager({ scoreSheets, studentNames }: { scoreSheets: ScoreSheet[], studentNames: StudentName[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuthStore();
  
  const [isOpen, setIsOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [editingSheet, setEditingSheet] = useState<ScoreSheet | null>(null);
  
  // Form State
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [className, setClassName] = useState("");
  const [term, setTerm] = useState("");
  const [session, setSession] = useState("");
  const [rows, setRows] = useState<ScoreRow[]>([]);

  const createMutation = useCreateScoreSheet({
    mutation: { onSuccess: () => { handleSuccess("Score sheet created"); } }
  });

  const updateMutation = useUpdateScoreSheet({
    mutation: { onSuccess: () => { handleSuccess("Score sheet updated"); } }
  });

  const deleteMutation = useDeleteScoreSheet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBootstrapQueryKey() });
        toast({ title: "Score sheet deleted" });
      }
    }
  });

  const handleSuccess = (msg: string) => {
    queryClient.invalidateQueries({ queryKey: getGetBootstrapQueryKey() });
    toast({ title: msg });
    setIsOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setEditingSheet(null);
    setTitle("");
    setSubject("");
    setClassName("");
    setTerm("");
    setSession("");
    setRows([]);
  };

  const handleEdit = (sheet: ScoreSheet) => {
    setEditingSheet(sheet);
    setTitle(sheet.title);
    setSubject(sheet.subject);
    setClassName(sheet.className);
    setTerm(sheet.term);
    setSession(sheet.session);
    setRows([...sheet.rows]);
    setIsOpen(true);
  };

  const addRow = () => {
    setRows([...rows, { studentName: "", ca: 0, exam: 0, total: 0, position: "" }]);
  };

  const updateRow = (index: number, field: keyof ScoreRow, value: any) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    
    if (field === 'ca' || field === 'exam') {
      newRows[index].total = Number(newRows[index].ca || 0) + Number(newRows[index].exam || 0);
    }
    
    setRows(newRows);
  };

  const removeRow = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const computePositions = () => {
    const sorted = [...rows].map((r, i) => ({ ...r, originalIndex: i }))
      .sort((a, b) => b.total - a.total);
    
    let currentPos = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].total < sorted[i-1].total) {
        currentPos = i + 1;
      }
      sorted[i].position = getOrdinalSuffix(currentPos);
    }

    const newRows = [...rows];
    sorted.forEach(s => {
      newRows[s.originalIndex].position = s.position;
    });
    setRows(newRows);
  };

  const saveSheet = (status: "draft" | "submitted") => {
    if (!user) return;
    const data = { title, subject, className, term, session, rows, staffId: user.id, status };
    if (editingSheet) {
      updateMutation.mutate({ id: editingSheet.id, data });
    } else {
      createMutation.mutate({ data });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Score Sheets</h2>
        <Dialog open={isOpen} onOpenChange={(open) => {
          if (!open) resetForm();
          setIsOpen(open);
        }}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}><Plus className="h-4 w-4 mr-2"/> New Score Sheet</Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>{editingSheet ? "Edit Score Sheet" : "Create Score Sheet"}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto pr-4 py-4 space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Mid-term Results" />
                </div>
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Input value={subject} onChange={e => setSubject(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Class</Label>
                  <Input value={className} onChange={e => setClassName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Term</Label>
                  <Input value={term} onChange={e => setTerm(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Session</Label>
                  <Input value={session} onChange={e => setSession(e.target.value)} placeholder="e.g. 2023/2024" />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium">Students</h3>
                  <div className="space-x-2">
                    <Button variant="outline" size="sm" onClick={computePositions}>Compute Positions</Button>
                    <Button size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1"/> Add Row</Button>
                  </div>
                </div>
                
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[250px]">Student Name</TableHead>
                        <TableHead>CA (40)</TableHead>
                        <TableHead>Exam (60)</TableHead>
                        <TableHead>Total (100)</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Select value={row.studentName} onValueChange={(val) => updateRow(idx, 'studentName', val)}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select student" />
                              </SelectTrigger>
                              <SelectContent>
                                {studentNames.map(sn => (
                                  <SelectItem key={sn.id} value={sn.name}>{sn.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell><Input type="number" value={row.ca || ''} onChange={e => updateRow(idx, 'ca', Number(e.target.value))} className="w-20" /></TableCell>
                          <TableCell><Input type="number" value={row.exam || ''} onChange={e => updateRow(idx, 'exam', Number(e.target.value))} className="w-20" /></TableCell>
                          <TableCell><span className="font-medium px-3">{row.total}</span></TableCell>
                          <TableCell><Input value={row.position} onChange={e => updateRow(idx, 'position', e.target.value)} className="w-20" placeholder="e.g. 1st"/></TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeRow(idx)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">Add rows to enter scores.</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 pt-4 border-t mt-auto">
              <Button variant="outline" onClick={() => saveSheet("draft")} disabled={createMutation.isPending || updateMutation.isPending}>
                <Save className="h-4 w-4 mr-2" /> Save Draft
              </Button>
              <Button onClick={() => saveSheet("submitted")} disabled={createMutation.isPending || updateMutation.isPending}>
                <Send className="h-4 w-4 mr-2" /> Submit to Admin
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scoreSheets.map(sheet => (
              <TableRow key={sheet.id}>
                <TableCell className="font-medium">{sheet.title}</TableCell>
                <TableCell>{sheet.subject}</TableCell>
                <TableCell>{sheet.className}</TableCell>
                <TableCell>
                  <Badge variant={sheet.status === 'submitted' ? 'default' : 'secondary'}>
                    {sheet.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-2 flex justify-end">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon"><Eye className="h-4 w-4"/></Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-[210mm] max-h-[297mm] p-8 overflow-auto">
                      <div className="a4-preview space-y-6">
                        <div className="text-center space-y-1 border-b pb-4">
                          <h1 className="text-2xl font-bold uppercase">{sheet.title}</h1>
                          <div className="flex justify-center gap-6 text-sm font-medium">
                            <span>Subject: {sheet.subject}</span>
                            <span>Class: {sheet.className}</span>
                            <span>Term: {sheet.term}</span>
                            <span>Session: {sheet.session}</span>
                          </div>
                        </div>
                        <Table className="border">
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="border-r font-bold text-black">Student Name</TableHead>
                              <TableHead className="border-r font-bold text-black">CA</TableHead>
                              <TableHead className="border-r font-bold text-black">Exam</TableHead>
                              <TableHead className="border-r font-bold text-black">Total</TableHead>
                              <TableHead className="font-bold text-black">Position</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sheet.rows.map((r, i) => (
                              <TableRow key={i}>
                                <TableCell className="border-r">{r.studentName}</TableCell>
                                <TableCell className="border-r">{r.ca}</TableCell>
                                <TableCell className="border-r">{r.exam}</TableCell>
                                <TableCell className="border-r font-medium">{r.total}</TableCell>
                                <TableCell>{r.position}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <div className="pt-8 flex justify-between">
                          <div className="border-t border-black w-48 text-center pt-2">Staff Signature</div>
                          <div className="border-t border-black w-48 text-center pt-2">Date</div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  {sheet.status === "draft" && (
                    <>
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(sheet)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this draft?")) {
                            deleteMutation.mutate({ id: sheet.id });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {scoreSheets.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No score sheets found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/staff/student-names.tsx
// ============================================================

import { useState } from "react";
import { StudentName } from "@workspace/api-client-react/src/generated/api.schemas";
import { useCreateStudentName, useDeleteStudentName, getGetBootstrapQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Search, Loader2 } from "lucide-react";

export function StudentNames({ studentNames }: { studentNames: StudentName[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuthStore();
  
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");

  const createMutation = useCreateStudentName({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBootstrapQueryKey() });
        toast({ title: "Student name added" });
        setName("");
      }
    }
  });

  const deleteMutation = useDeleteStudentName({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBootstrapQueryKey() });
        toast({ title: "Student name deleted" });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !user) return;
    createMutation.mutate({ data: { name, createdBy: user.id } });
  };

  const filteredNames = studentNames.filter(sn => 
    sn.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 items-end md:justify-between">
        <form onSubmit={handleSubmit} className="flex gap-2 w-full md:w-auto items-end">
          <div className="space-y-2 flex-1">
            <Label>Add New Student Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full Name" />
          </div>
          <Button type="submit" disabled={!name || createMutation.isPending}>
            {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Add
          </Button>
        </form>

        <div className="relative w-full md:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            className="pl-8" 
            placeholder="Search names..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student Name</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredNames.map(sn => (
              <TableRow key={sn.id}>
                <TableCell className="font-medium">{sn.name}</TableCell>
                <TableCell className="text-right">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      if (confirm("Are you sure you want to delete this name?")) {
                        deleteMutation.mutate({ id: sn.id });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filteredNames.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                  {search ? "No matching names found." : "No student names added yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/accordion.tsx
// ============================================================

import * as React from "react"
import * as AccordionPrimitive from "@radix-ui/react-accordion"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

const Accordion = AccordionPrimitive.Root

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn("border-b", className)}
    {...props}
  />
))
AccordionItem.displayName = "AccordionItem"

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex flex-1 items-center justify-between py-4 text-sm font-medium transition-all hover:underline text-left [&[data-state=open]>svg]:rotate-180",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
))
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
    {...props}
  >
    <div className={cn("pb-4 pt-0", className)}>{children}</div>
  </AccordionPrimitive.Content>
))
AccordionContent.displayName = AccordionPrimitive.Content.displayName

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/alert-dialog.tsx
// ============================================================

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    />
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants(), className)}
    {...props}
  />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(
      buttonVariants({ variant: "outline" }),
      "mt-2 sm:mt-0",
      className
    )}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/alert.tsx
// ============================================================

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/aspect-ratio.tsx
// ============================================================

import * as AspectRatioPrimitive from "@radix-ui/react-aspect-ratio"

const AspectRatio = AspectRatioPrimitive.Root

export { AspectRatio }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/avatar.tsx
// ============================================================

"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className
    )}
    {...props}
  />
))
Avatar.displayName = AvatarPrimitive.Root.displayName

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

export { Avatar, AvatarImage, AvatarFallback }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/badge.tsx
// ============================================================

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // @replit
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate ",
  {
    variants: {
      variant: {
        default:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary:
          // @replit no hover because we use hover-elevate
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",
          // @replit shadow-xs" - use badge outline variable
        outline: "text-foreground border [border-color:var(--badge-outline)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/breadcrumb.tsx
// ============================================================

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

const Breadcrumb = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"nav"> & {
    separator?: React.ReactNode
  }
>(({ ...props }, ref) => <nav ref={ref} aria-label="breadcrumb" {...props} />)
Breadcrumb.displayName = "Breadcrumb"

const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<"ol">
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn(
      "flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
      className
    )}
    {...props}
  />
))
BreadcrumbList.displayName = "BreadcrumbList"

const BreadcrumbItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentPropsWithoutRef<"li">
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("inline-flex items-center gap-1.5", className)}
    {...props}
  />
))
BreadcrumbItem.displayName = "BreadcrumbItem"

const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<"a"> & {
    asChild?: boolean
  }
>(({ asChild, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      ref={ref}
      className={cn("transition-colors hover:text-foreground", className)}
      {...props}
    />
  )
})
BreadcrumbLink.displayName = "BreadcrumbLink"

const BreadcrumbPage = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span">
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    role="link"
    aria-disabled="true"
    aria-current="page"
    className={cn("font-normal text-foreground", className)}
    {...props}
  />
))
BreadcrumbPage.displayName = "BreadcrumbPage"

const BreadcrumbSeparator = ({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) => (
  <li
    role="presentation"
    aria-hidden="true"
    className={cn("[&>svg]:w-3.5 [&>svg]:h-3.5", className)}
    {...props}
  >
    {children ?? <ChevronRight />}
  </li>
)
BreadcrumbSeparator.displayName = "BreadcrumbSeparator"

const BreadcrumbEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    role="presentation"
    aria-hidden="true"
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More</span>
  </span>
)
BreadcrumbEllipsis.displayName = "BreadcrumbElipssis"

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/button-group.tsx
// ============================================================

import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

const buttonGroupVariants = cva(
  "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none",
        vertical:
          "flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  }
)

function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}

function ButtonGroupText({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      className={cn(
        "bg-muted shadow-xs flex items-center gap-2 rounded-md border px-4 text-sm font-medium [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        "bg-input relative !m-0 self-stretch data-[orientation=vertical]:h-auto",
        className
      )}
      {...props}
    />
  )
}

export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/button.tsx
// ============================================================

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
           // @replit: no hover, and add primary border
           "bg-primary text-primary-foreground border border-primary-border",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/calendar.tsx
// ============================================================

"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3 [--cell-size:2rem] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "h-[--cell-size] w-[--cell-size] select-none p-0 aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-[--cell-size] w-full items-center justify-center px-[--cell-size]",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-[--cell-size] w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "bg-popover absolute inset-0 opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "select-none font-medium",
          captionLayout === "label"
            ? "text-sm"
            : "[&>svg]:text-muted-foreground flex h-8 items-center gap-1 rounded-md pl-2 pr-1 text-sm [&>svg]:size-3.5",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground flex-1 select-none rounded-md text-[0.8rem] font-normal",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-[--cell-size] select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-muted-foreground select-none text-[0.8rem]",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full select-none p-0 text-center [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md",
          defaultClassNames.day
        ),
        range_start: cn(
          "bg-accent rounded-l-md",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("bg-accent rounded-r-md", defaultClassNames.range_end),
        today: cn(
          "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-[--cell-size] items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 flex aspect-square h-auto w-full min-w-[--cell-size] flex-col gap-1 font-normal leading-none data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/card.tsx
// ============================================================

import * as React from "react"

import { cn } from "@/lib/utils"

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-xl border bg-card text-card-foreground shadow",
      className
    )}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/carousel.tsx
// ============================================================

import * as React from "react"
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react"
import { ArrowLeft, ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

type CarouselApi = UseEmblaCarouselType[1]
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>
type CarouselOptions = UseCarouselParameters[0]
type CarouselPlugin = UseCarouselParameters[1]

type CarouselProps = {
  opts?: CarouselOptions
  plugins?: CarouselPlugin
  orientation?: "horizontal" | "vertical"
  setApi?: (api: CarouselApi) => void
}

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0]
  api: ReturnType<typeof useEmblaCarousel>[1]
  scrollPrev: () => void
  scrollNext: () => void
  canScrollPrev: boolean
  canScrollNext: boolean
} & CarouselProps

const CarouselContext = React.createContext<CarouselContextProps | null>(null)

function useCarousel() {
  const context = React.useContext(CarouselContext)

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />")
  }

  return context
}

const Carousel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & CarouselProps
>(
  (
    {
      orientation = "horizontal",
      opts,
      setApi,
      plugins,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const [carouselRef, api] = useEmblaCarousel(
      {
        ...opts,
        axis: orientation === "horizontal" ? "x" : "y",
      },
      plugins
    )
    const [canScrollPrev, setCanScrollPrev] = React.useState(false)
    const [canScrollNext, setCanScrollNext] = React.useState(false)

    const onSelect = React.useCallback((api: CarouselApi) => {
      if (!api) {
        return
      }

      setCanScrollPrev(api.canScrollPrev())
      setCanScrollNext(api.canScrollNext())
    }, [])

    const scrollPrev = React.useCallback(() => {
      api?.scrollPrev()
    }, [api])

    const scrollNext = React.useCallback(() => {
      api?.scrollNext()
    }, [api])

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault()
          scrollPrev()
        } else if (event.key === "ArrowRight") {
          event.preventDefault()
          scrollNext()
        }
      },
      [scrollPrev, scrollNext]
    )

    React.useEffect(() => {
      if (!api || !setApi) {
        return
      }

      setApi(api)
    }, [api, setApi])

    React.useEffect(() => {
      if (!api) {
        return
      }

      onSelect(api)
      api.on("reInit", onSelect)
      api.on("select", onSelect)

      return () => {
        api?.off("select", onSelect)
      }
    }, [api, onSelect])

    return (
      <CarouselContext.Provider
        value={{
          carouselRef,
          api: api,
          opts,
          orientation:
            orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
          scrollPrev,
          scrollNext,
          canScrollPrev,
          canScrollNext,
        }}
      >
        <div
          ref={ref}
          onKeyDownCapture={handleKeyDown}
          className={cn("relative", className)}
          role="region"
          aria-roledescription="carousel"
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    )
  }
)
Carousel.displayName = "Carousel"

const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { carouselRef, orientation } = useCarousel()

  return (
    <div ref={carouselRef} className="overflow-hidden">
      <div
        ref={ref}
        className={cn(
          "flex",
          orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col",
          className
        )}
        {...props}
      />
    </div>
  )
})
CarouselContent.displayName = "CarouselContent"

const CarouselItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { orientation } = useCarousel()

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      className={cn(
        "min-w-0 shrink-0 grow-0 basis-full",
        orientation === "horizontal" ? "pl-4" : "pt-4",
        className
      )}
      {...props}
    />
  )
})
CarouselItem.displayName = "CarouselItem"

const CarouselPrevious = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, variant = "outline", size = "icon", ...props }, ref) => {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel()

  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        "absolute  h-8 w-8 rounded-full",
        orientation === "horizontal"
          ? "-left-12 top-1/2 -translate-y-1/2"
          : "-top-12 left-1/2 -translate-x-1/2 rotate-90",
        className
      )}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="sr-only">Previous slide</span>
    </Button>
  )
})
CarouselPrevious.displayName = "CarouselPrevious"

const CarouselNext = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, variant = "outline", size = "icon", ...props }, ref) => {
  const { orientation, scrollNext, canScrollNext } = useCarousel()

  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        "absolute h-8 w-8 rounded-full",
        orientation === "horizontal"
          ? "-right-12 top-1/2 -translate-y-1/2"
          : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90",
        className
      )}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}
    >
      <ArrowRight className="h-4 w-4" />
      <span className="sr-only">Next slide</span>
    </Button>
  )
})
CarouselNext.displayName = "CarouselNext"

export {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/chart.tsx
// ============================================================

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }

  return context
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig
    children: React.ComponentProps<
      typeof RechartsPrimitive.ResponsiveContainer
    >["children"]
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = "Chart"

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, config]) => config.theme || config.color
  )

  if (!colorConfig.length) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
      itemConfig.color
    return color ? `  --color-${key}: ${color};` : null
  })
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
    React.ComponentProps<"div"> & {
      hideLabel?: boolean
      hideIndicator?: boolean
      indicator?: "line" | "dot" | "dashed"
      nameKey?: string
      labelKey?: string
    }
>(
  (
    {
      active,
      payload,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey,
    },
    ref
  ) => {
    const { config } = useChart()

    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) {
        return null
      }

      const [item] = payload
      const key = `${labelKey || item?.dataKey || item?.name || "value"}`
      const itemConfig = getPayloadConfigFromPayload(config, item, key)
      const value =
        !labelKey && typeof label === "string"
          ? config[label as keyof typeof config]?.label || label
          : itemConfig?.label

      if (labelFormatter) {
        return (
          <div className={cn("font-medium", labelClassName)}>
            {labelFormatter(value, payload)}
          </div>
        )
      }

      if (!value) {
        return null
      }

      return <div className={cn("font-medium", labelClassName)}>{value}</div>
    }, [
      label,
      labelFormatter,
      payload,
      hideLabel,
      labelClassName,
      config,
      labelKey,
    ])

    if (!active || !payload?.length) {
      return null
    }

    const nestLabel = payload.length === 1 && indicator !== "dot"

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
          className
        )}
      >
        {!nestLabel ? tooltipLabel : null}
        <div className="grid gap-1.5">
          {payload
            .filter((item) => item.type !== "none")
            .map((item, index) => {
              const key = `${nameKey || item.name || item.dataKey || "value"}`
              const itemConfig = getPayloadConfigFromPayload(config, item, key)
              const indicatorColor = color || item.payload.fill || item.color

              return (
                <div
                  key={item.dataKey}
                  className={cn(
                    "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                    indicator === "dot" && "items-center"
                  )}
                >
                  {formatter && item?.value !== undefined && item.name ? (
                    formatter(item.value, item.name, item, index, item.payload)
                  ) : (
                    <>
                      {itemConfig?.icon ? (
                        <itemConfig.icon />
                      ) : (
                        !hideIndicator && (
                          <div
                            className={cn(
                              "shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]",
                              {
                                "h-2.5 w-2.5": indicator === "dot",
                                "w-1": indicator === "line",
                                "w-0 border-[1.5px] border-dashed bg-transparent":
                                  indicator === "dashed",
                                "my-0.5": nestLabel && indicator === "dashed",
                              }
                            )}
                            style={
                              {
                                "--color-bg": indicatorColor,
                                "--color-border": indicatorColor,
                              } as React.CSSProperties
                            }
                          />
                        )
                      )}
                      <div
                        className={cn(
                          "flex flex-1 justify-between leading-none",
                          nestLabel ? "items-end" : "items-center"
                        )}
                      >
                        <div className="grid gap-1.5">
                          {nestLabel ? tooltipLabel : null}
                          <span className="text-muted-foreground">
                            {itemConfig?.label || item.name}
                          </span>
                        </div>
                        {item.value && (
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {item.value.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
        </div>
      </div>
    )
  }
)
ChartTooltipContent.displayName = "ChartTooltip"

const ChartLegend = RechartsPrimitive.Legend

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> &
    Pick<RechartsPrimitive.LegendProps, "payload" | "verticalAlign"> & {
      hideIcon?: boolean
      nameKey?: string
    }
>(
  (
    { className, hideIcon = false, payload, verticalAlign = "bottom", nameKey },
    ref
  ) => {
    const { config } = useChart()

    if (!payload?.length) {
      return null
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center justify-center gap-4",
          verticalAlign === "top" ? "pb-3" : "pt-3",
          className
        )}
      >
        {payload
          .filter((item) => item.type !== "none")
          .map((item) => {
            const key = `${nameKey || item.dataKey || "value"}`
            const itemConfig = getPayloadConfigFromPayload(config, item, key)

            return (
              <div
                key={item.value}
                className={cn(
                  "flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
                )}
              >
                {itemConfig?.icon && !hideIcon ? (
                  <itemConfig.icon />
                ) : (
                  <div
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{
                      backgroundColor: item.color,
                    }}
                  />
                )}
                {itemConfig?.label}
              </div>
            )
          })}
      </div>
    )
  }
)
ChartLegendContent.displayName = "ChartLegend"

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
) {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const payloadPayload =
    "payload" in payload &&
    typeof payload.payload === "object" &&
    payload.payload !== null
      ? payload.payload
      : undefined

  let configLabelKey: string = key

  if (
    key in payload &&
    typeof payload[key as keyof typeof payload] === "string"
  ) {
    configLabelKey = payload[key as keyof typeof payload] as string
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[
      key as keyof typeof payloadPayload
    ] as string
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config]
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/checkbox.tsx
// ============================================================

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("grid place-content-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/collapsible.tsx
// ============================================================

"use client"

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/command.tsx
// ============================================================

"use client"

import * as React from "react"
import { type DialogProps } from "@radix-ui/react-dialog"
import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Dialog, DialogContent } from "@/components/ui/dialog"

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
      className
    )}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

const CommandDialog = ({ children, ...props }: DialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  </div>
))

CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
))

CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm"
    {...props}
  />
))

CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className
    )}
    {...props}
  />
))

CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
))
CommandSeparator.displayName = CommandPrimitive.Separator.displayName

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      className
    )}
    {...props}
  />
))

CommandItem.displayName = CommandPrimitive.Item.displayName

const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
CommandShortcut.displayName = "CommandShortcut"

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/context-menu.tsx
// ============================================================

import * as React from "react"
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const ContextMenu = ContextMenuPrimitive.Root

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

const ContextMenuGroup = ContextMenuPrimitive.Group

const ContextMenuPortal = ContextMenuPrimitive.Portal

const ContextMenuSub = ContextMenuPrimitive.Sub

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </ContextMenuPrimitive.SubTrigger>
))
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-context-menu-content-transform-origin]",
      className
    )}
    {...props}
  />
))
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-50 max-h-[--radix-context-menu-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-context-menu-content-transform-origin]",
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
))
ContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Circle className="h-4 w-4 fill-current" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
))
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold text-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
ContextMenuShortcut.displayName = "ContextMenuShortcut"

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/dialog.tsx
// ============================================================

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/drawer.tsx
// ============================================================

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"

const Drawer = ({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerPrimitive.Root
    shouldScaleBackground={shouldScaleBackground}
    {...props}
  />
)
Drawer.displayName = "Drawer"

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/80", className)}
    {...props}
  />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background",
        className
      )}
      {...props}
    >
      <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
))
DrawerContent.displayName = "DrawerContent"

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)}
    {...props}
  />
)
DrawerHeader.displayName = "DrawerHeader"

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
)
DrawerFooter.displayName = "DrawerFooter"

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/dropdown-menu.tsx
// ============================================================

"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/empty.tsx
// ============================================================

import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 text-balance rounded-lg border-dashed p-6 text-center md:p-12",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className
      )}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("text-lg font-medium tracking-tight", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-balance text-sm",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/field.tsx
// ============================================================

"use client"

import { useMemo } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "flex flex-col gap-6",
        "has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-3 font-medium",
        "data-[variant=legend]:text-base",
        "data-[variant=label]:text-sm",
        className
      )}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4",
        className
      )}
      {...props}
    />
  )
}

const fieldVariants = cva(
  "group/field data-[invalid=true]:text-destructive flex w-full gap-3",
  {
    variants: {
      orientation: {
        vertical: ["flex-col [&>*]:w-full [&>.sr-only]:w-auto"],
        horizontal: [
          "flex-row items-center",
          "[&>[data-slot=field-label]]:flex-auto",
          "has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px has-[>[data-slot=field-content]]:items-start",
        ],
        responsive: [
          "@md/field-group:flex-row @md/field-group:items-center @md/field-group:[&>*]:w-auto flex-col [&>*]:w-full [&>.sr-only]:w-auto",
          "@md/field-group:[&>[data-slot=field-label]]:flex-auto",
          "@md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        ],
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "group/field-content flex flex-1 flex-col gap-1.5 leading-snug",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>[data-slot=field]]:p-4",
        "has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:border-primary dark:has-data-[state=checked]:bg-primary/10",
        className
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "flex w-fit items-center gap-2 text-sm font-medium leading-snug group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-muted-foreground text-sm font-normal leading-normal group-has-[[data-orientation=horizontal]]/field:text-balance",
        "nth-last-2:-mt-1 last:mt-0 [[data-variant=legend]+&]:-mt-1.5",
        "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="bg-background text-muted-foreground relative mx-auto block w-fit px-2"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors) {
      return null
    }

    if (errors?.length === 1 && errors[0]?.message) {
      return errors[0].message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {errors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-destructive text-sm font-normal", className)}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/form.tsx
// ============================================================

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { Slot } from "@radix-ui/react-slot"
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>")
  }

  if (!itemContext) {
    throw new Error("useFormField should be used within <FormItem>")
  }

  const fieldState = getFieldState(fieldContext.name, formState)

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue | null>(null)

const FormItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const id = React.useId()

  return (
    <FormItemContext.Provider value={{ id }}>
      <div ref={ref} className={cn("space-y-2", className)} {...props} />
    </FormItemContext.Provider>
  )
})
FormItem.displayName = "FormItem"

const FormLabel = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField()

  return (
    <Label
      ref={ref}
      className={cn(error && "text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  )
})
FormLabel.displayName = "FormLabel"

const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={
        !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={!!error}
      {...props}
    />
  )
})
FormControl.displayName = "FormControl"

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField()

  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn("text-[0.8rem] text-muted-foreground", className)}
      {...props}
    />
  )
})
FormDescription.displayName = "FormDescription"

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message ?? "") : children

  if (!body) {
    return null
  }

  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn("text-[0.8rem] font-medium text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  )
})
FormMessage.displayName = "FormMessage"

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/hover-card.tsx
// ============================================================

import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"

import { cn } from "@/lib/utils"

const HoverCard = HoverCardPrimitive.Root

const HoverCardTrigger = HoverCardPrimitive.Trigger

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-hover-card-content-transform-origin]",
      className
    )}
    {...props}
  />
))
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName

export { HoverCard, HoverCardTrigger, HoverCardContent }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/input-group.tsx
// ============================================================

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group border-input dark:bg-input/30 shadow-xs relative flex w-full items-center rounded-md border outline-none transition-[color,box-shadow]",
        "h-9 has-[>textarea]:h-auto",

        // Variants based on alignment.
        "has-[>[data-align=inline-start]]:[&>input]:pl-2",
        "has-[>[data-align=inline-end]]:[&>input]:pr-2",
        "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3",
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3",

        // Focus state.
        "has-[[data-slot=input-group-control]:focus-visible]:ring-ring has-[[data-slot=input-group-control]:focus-visible]:ring-1",

        // Error state.
        "has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[[data-slot][aria-invalid=true]]:border-destructive dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40",

        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "text-muted-foreground flex h-auto cursor-text select-none items-center justify-center gap-2 py-1.5 text-sm font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start":
          "order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]",
        "inline-end":
          "order-last pr-3 has-[>button]:mr-[-0.4rem] has-[>kbd]:mr-[-0.35rem]",
        "block-start":
          "[.border-b]:pb-3 order-first w-full justify-start px-3 pt-3 group-has-[>input]/input-group:pt-2.5",
        "block-end":
          "[.border-t]:pt-3 order-last w-full justify-start px-3 pb-3 group-has-[>input]/input-group:pb-2.5",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "flex items-center gap-2 text-sm shadow-none",
  {
    variants: {
      size: {
        xs: "h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5",
        "icon-xs":
          "size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0",
        "icon-sm": "size-8 p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-muted-foreground flex items-center gap-2 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 dark:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/input-otp.tsx
// ============================================================

import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"
import { Minus } from "lucide-react"

import { cn } from "@/lib/utils"

const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName
    )}
    className={cn("disabled:cursor-not-allowed", className)}
    {...props}
  />
))
InputOTP.displayName = "InputOTP"

const InputOTPGroup = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center", className)} {...props} />
))
InputOTPGroup.displayName = "InputOTPGroup"

const InputOTPSlot = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div"> & { index: number }
>(({ index, className, ...props }, ref) => {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index]

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center border-y border-r border-input text-sm shadow-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
        isActive && "z-10 ring-1 ring-ring",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  )
})
InputOTPSlot.displayName = "InputOTPSlot"

const InputOTPSeparator = React.forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}>
    <Minus />
  </div>
))
InputOTPSeparator.displayName = "InputOTPSeparator"

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/input.tsx
// ============================================================

import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/item.tsx
// ============================================================

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="list"
      data-slot="item-group"
      className={cn("group/item-group flex flex-col", className)}
      {...props}
    />
  )
}

function ItemSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn("my-0", className)}
      {...props}
    />
  )
}

const itemVariants = cva(
  "group/item [a]:hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-ring/50 [a]:transition-colors flex flex-wrap items-center rounded-md border border-transparent text-sm outline-none transition-colors duration-100 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-border",
        muted: "bg-muted/50",
      },
      size: {
        default: "gap-4 p-4 ",
        sm: "gap-2.5 px-4 py-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Item({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof itemVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div"
  return (
    <Comp
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(itemVariants({ variant, size, className }))}
      {...props}
    />
  )
}

const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:translate-y-0.5 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted size-8 rounded-sm border [&_svg:not([class*='size-'])]:size-4",
        image:
          "size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function ItemMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        "flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none",
        className
      )}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        "flex w-fit items-center gap-2 text-sm font-medium leading-snug",
        className
      )}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "text-muted-foreground line-clamp-2 text-balance text-sm font-normal leading-normal",
        "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        "flex basis-full items-center justify-between gap-2",
        className
      )}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn(
        "flex basis-full items-center justify-between gap-2",
        className
      )}
      {...props}
    />
  )
}

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/kbd.tsx
// ============================================================

import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "bg-muted text-muted-foreground pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm px-1 font-sans text-xs font-medium",
        "[&_svg:not([class*='size-'])]:size-3",
        "[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/label.tsx
// ============================================================

"use client"

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/menubar.tsx
// ============================================================

import * as React from "react"
import * as MenubarPrimitive from "@radix-ui/react-menubar"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

function MenubarMenu({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu {...props} />
}

function MenubarGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group {...props} />
}

function MenubarPortal({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal {...props} />
}

function MenubarRadioGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return <MenubarPrimitive.RadioGroup {...props} />
}

function MenubarSub({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />
}

const Menubar = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Root
    ref={ref}
    className={cn(
      "flex h-9 items-center space-x-1 rounded-md border bg-background p-1 shadow-sm",
      className
    )}
    {...props}
  />
))
Menubar.displayName = MenubarPrimitive.Root.displayName

const MenubarTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-3 py-1 text-sm font-medium outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      className
    )}
    {...props}
  />
))
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName

const MenubarSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <MenubarPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </MenubarPrimitive.SubTrigger>
))
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName

const MenubarSubContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-menubar-content-transform-origin]",
      className
    )}
    {...props}
  />
))
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName

const MenubarContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(
  (
    { className, align = "start", alignOffset = -4, sideOffset = 8, ...props },
    ref
  ) => (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content
        ref={ref}
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-menubar-content-transform-origin]",
          className
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  )
)
MenubarContent.displayName = MenubarPrimitive.Content.displayName

const MenubarItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
MenubarItem.displayName = MenubarPrimitive.Item.displayName

const MenubarCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <MenubarPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.CheckboxItem>
))
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName

const MenubarRadioItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Circle className="h-4 w-4 fill-current" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.RadioItem>
))
MenubarRadioItem.displayName = MenubarPrimitive.RadioItem.displayName

const MenubarLabel = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
MenubarLabel.displayName = MenubarPrimitive.Label.displayName

const MenubarSeparator = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName

const MenubarShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
MenubarShortcut.displayname = "MenubarShortcut"

export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarLabel,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarPortal,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarGroup,
  MenubarSub,
  MenubarShortcut,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/navigation-menu.tsx
// ============================================================

import * as React from "react"
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu"
import { cva } from "class-variance-authority"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

const NavigationMenu = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Root
    ref={ref}
    className={cn(
      "relative z-10 flex max-w-max flex-1 items-center justify-center",
      className
    )}
    {...props}
  >
    {children}
    <NavigationMenuViewport />
  </NavigationMenuPrimitive.Root>
))
NavigationMenu.displayName = NavigationMenuPrimitive.Root.displayName

const NavigationMenuList = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.List>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.List
    ref={ref}
    className={cn(
      "group flex flex-1 list-none items-center justify-center space-x-1",
      className
    )}
    {...props}
  />
))
NavigationMenuList.displayName = NavigationMenuPrimitive.List.displayName

const NavigationMenuItem = NavigationMenuPrimitive.Item

const navigationMenuTriggerStyle = cva(
  "group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:text-accent-foreground data-[state=open]:bg-accent/50 data-[state=open]:hover:bg-accent data-[state=open]:focus:bg-accent"
)

const NavigationMenuTrigger = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <NavigationMenuPrimitive.Trigger
    ref={ref}
    className={cn(navigationMenuTriggerStyle(), "group", className)}
    {...props}
  >
    {children}{" "}
    <ChevronDown
      className="relative top-[1px] ml-1 h-3 w-3 transition duration-300 group-data-[state=open]:rotate-180"
      aria-hidden="true"
    />
  </NavigationMenuPrimitive.Trigger>
))
NavigationMenuTrigger.displayName = NavigationMenuPrimitive.Trigger.displayName

const NavigationMenuContent = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Content
    ref={ref}
    className={cn(
      "left-0 top-0 w-full data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52 data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52 md:absolute md:w-auto ",
      className
    )}
    {...props}
  />
))
NavigationMenuContent.displayName = NavigationMenuPrimitive.Content.displayName

const NavigationMenuLink = NavigationMenuPrimitive.Link

const NavigationMenuViewport = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <div className={cn("absolute left-0 top-full flex justify-center")}>
    <NavigationMenuPrimitive.Viewport
      className={cn(
        "origin-top-center relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 md:w-[var(--radix-navigation-menu-viewport-width)]",
        className
      )}
      ref={ref}
      {...props}
    />
  </div>
))
NavigationMenuViewport.displayName =
  NavigationMenuPrimitive.Viewport.displayName

const NavigationMenuIndicator = React.forwardRef<
  React.ElementRef<typeof NavigationMenuPrimitive.Indicator>,
  React.ComponentPropsWithoutRef<typeof NavigationMenuPrimitive.Indicator>
>(({ className, ...props }, ref) => (
  <NavigationMenuPrimitive.Indicator
    ref={ref}
    className={cn(
      "top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden data-[state=visible]:animate-in data-[state=hidden]:animate-out data-[state=hidden]:fade-out data-[state=visible]:fade-in",
      className
    )}
    {...props}
  >
    <div className="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-border shadow-md" />
  </NavigationMenuPrimitive.Indicator>
))
NavigationMenuIndicator.displayName =
  NavigationMenuPrimitive.Indicator.displayName

export {
  navigationMenuTriggerStyle,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/pagination.tsx
// ============================================================

import * as React from "react"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { ButtonProps, buttonVariants } from "@/components/ui/button"

const Pagination = ({ className, ...props }: React.ComponentProps<"nav">) => (
  <nav
    role="navigation"
    aria-label="pagination"
    className={cn("mx-auto flex w-full justify-center", className)}
    {...props}
  />
)
Pagination.displayName = "Pagination"

const PaginationContent = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-row items-center gap-1", className)}
    {...props}
  />
))
PaginationContent.displayName = "PaginationContent"

const PaginationItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("", className)} {...props} />
))
PaginationItem.displayName = "PaginationItem"

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<ButtonProps, "size"> &
  React.ComponentProps<"a">

const PaginationLink = ({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? "outline" : "ghost",
        size,
      }),
      className
    )}
    {...props}
  />
)
PaginationLink.displayName = "PaginationLink"

const PaginationPrevious = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to previous page"
    size="default"
    className={cn("gap-1 pl-2.5", className)}
    {...props}
  >
    <ChevronLeft className="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
)
PaginationPrevious.displayName = "PaginationPrevious"

const PaginationNext = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to next page"
    size="default"
    className={cn("gap-1 pr-2.5", className)}
    {...props}
  >
    <span>Next</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
)
PaginationNext.displayName = "PaginationNext"

const PaginationEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    aria-hidden
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
)
PaginationEllipsis.displayName = "PaginationEllipsis"

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/popover.tsx
// ============================================================

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/progress.tsx
// ============================================================

"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/radio-group.tsx
// ============================================================

import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "aspect-square h-4 w-4 rounded-full border border-primary text-primary shadow focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle className="h-3.5 w-3.5 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/resizable.tsx
// ============================================================

"use client"

import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
)

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/scroll-area.tsx
// ============================================================

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/select.tsx
// ============================================================

"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/separator.tsx
// ============================================================

import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/sheet.tsx
// ============================================================

"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/sidebar.tsx
// ============================================================

"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, VariantProps } from "class-variance-authority"
import { PanelLeftIcon } from "lucide-react"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "bg-sidebar text-sidebar-foreground flex h-full w-[var(--sidebar-width)] flex-col",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="bg-sidebar text-sidebar-foreground w-[var(--sidebar-width)] p-0 [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-[var(--sidebar-width)] bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+var(--spacing-4))]"
            : "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]"
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear md:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+var(--spacing-4)+2px)]"
            : "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  // Note: Tailwind v3.4 doesn't support "in-" selectors. So the rail won't work perfectly.
  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "bg-background relative flex w-full flex-1 flex-col",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("bg-background h-8 w-full shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("bg-sidebar-border mx-2 w-auto", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:w-8! group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  showOnHover?: boolean
}) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  }, [])

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-[var(--skeleton-width)] flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "border-sidebar-border mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
  size?: "sm" | "md"
  isActive?: boolean
}) {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 outline outline-2 outline-transparent outline-offset-2 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/skeleton.tsx
// ============================================================

import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  )
}

export { Skeleton }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/slider.tsx
// ============================================================

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/sonner.tsx
// ============================================================

"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/spinner.tsx
// ============================================================

import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/switch.tsx
// ============================================================

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/table.tsx
// ============================================================

import * as React from "react"

import { cn } from "@/lib/utils"

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/tabs.tsx
// ============================================================

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/textarea.tsx
// ============================================================

import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/toast.tsx
// ============================================================

import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/toaster.tsx
// ============================================================

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/toggle-group.tsx
// ============================================================

"use client"

import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
})

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("flex items-center justify-center gap-1", className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
))

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
})

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/toggle.tsx
// ============================================================

import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))

Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle, toggleVariants }


// ============================================================
// FILE: artifacts/quality-school-sis/src/components/ui/tooltip.tsx
// ============================================================

"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }


// ============================================================
// FILE: artifacts/quality-school-sis/src/hooks/use-mobile.tsx
// ============================================================

import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/hooks/use-toast.ts
// ============================================================

import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId)
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id)
        })
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      }
    }
    case "REMOVE_TOAST":
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

export { useToast, toast }


// ============================================================
// FILE: artifacts/quality-school-sis/src/lib/auth.ts
// ============================================================

import { useSyncExternalStore } from "react";
import type { User } from "@workspace/api-client-react";

interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => void;
}

const storageKey = "sis-auth-storage";
const listeners = new Set<() => void>();
let currentUser: User | null = loadUser();

function loadUser(): User | null {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? (JSON.parse(saved) as User) : null;
  } catch {
    return null;
  }
}

function writeUser(user: User | null) {
  currentUser = user;
  if (user) {
    localStorage.setItem(storageKey, JSON.stringify(user));
  } else {
    localStorage.removeItem(storageKey);
  }
  listeners.forEach((listener) => listener());
}

function readUser(): User | null {
  return currentUser;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAuthStore(): AuthState {
  const user = useSyncExternalStore(subscribe, readUser, () => null);
  return {
    user,
    setUser: writeUser,
    logout: () => writeUser(null),
  };
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/lib/utils-ext.ts
// ============================================================

export function getOrdinalSuffix(i: number): string {
  const j = i % 10,
        k = i % 100;
  if (j === 1 && k !== 11) {
      return i + "st";
  }
  if (j === 2 && k !== 12) {
      return i + "nd";
  }
  if (j === 3 && k !== 13) {
      return i + "rd";
  }
  return i + "th";
}

export function parseOrdinal(str: string): number {
  const parsed = parseInt(str.replace(/\D/g, ''), 10);
  return isNaN(parsed) ? 0 : parsed;
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/lib/utils.ts
// ============================================================

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/main.tsx
// ============================================================

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);


// ============================================================
// FILE: artifacts/quality-school-sis/src/pages/admin.tsx
// ============================================================

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuthStore } from "@/lib/auth";
import { useGetBootstrap } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, FileText, BookOpen } from "lucide-react";
import { UserManagement } from "@/components/admin/user-management";
import { ScoreSheetsList } from "@/components/admin/score-sheets-list";
import { ReportsList } from "@/components/admin/reports-list";
import { ReportGenerator } from "@/components/staff/report-generator";

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!user) {
      setLocation("/");
    } else if (user.role !== "admin") {
      setLocation("/staff");
    }
  }, [user, setLocation]);

  const { data: bootstrapData, isLoading } = useGetBootstrap();

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{bootstrapData?.users?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Submitted Score Sheets</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {bootstrapData?.scoreSheets?.filter(s => s.status === 'submitted').length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reports</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{bootstrapData?.reports?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">User Management</TabsTrigger>
          <TabsTrigger value="score-sheets">Score Sheets</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <Card>
            <CardContent className="pt-6">
              <UserManagement users={bootstrapData?.users || []} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="score-sheets">
          <Card>
            <CardContent className="pt-6">
              <ScoreSheetsList scoreSheets={bootstrapData?.scoreSheets || []} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <ReportGenerator
                reports={bootstrapData?.reports || []}
                scoreSheets={bootstrapData?.scoreSheets || []}
                studentNames={bootstrapData?.studentNames || []}
                schoolInfo={bootstrapData?.school!}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <ReportsList reports={(bootstrapData?.reports || []).filter((report) => report.status === "submitted")} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/pages/login.tsx
// ============================================================

import { useState } from "react";
import { useLocation } from "wouter";
import { useLoginUser } from "@workspace/api-client-react";
import { useAuthStore } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, Loader2 } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { setUser } = useAuthStore();
  const { toast } = useToast();
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useLoginUser({
    mutation: {
      onSuccess: (data) => {
        if (data.ok && data.user) {
          setUser(data.user);
          setLocation(data.user.role === "admin" ? "/admin" : "/staff");
        } else {
          toast({
            variant: "destructive",
            title: "Login Failed",
            description: data.message || "Wrong username or password",
          });
        }
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Login Error",
          description: "An unexpected error occurred.",
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    loginMutation.mutate({ data: { username, password } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-lg border-primary/10">
        <CardHeader className="space-y-2 text-center pb-8">
          <div className="mx-auto bg-primary/10 w-16 h-16 flex items-center justify-center rounded-full mb-4">
            <GraduationCap className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Quality School Complex</CardTitle>
          <CardDescription className="text-base">
            Sign in to the Student Information System
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input 
                id="username" 
                placeholder="Enter your username" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input 
                id="password" 
                type="password" 
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              type="submit" 
              className="w-full font-medium" 
              disabled={loginMutation.isPending || !username || !password}
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/pages/not-found.tsx
// ============================================================

import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/src/pages/staff.tsx
// ============================================================

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuthStore } from "@/lib/auth";
import { useGetBootstrap } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, FileText, BookOpen } from "lucide-react";
import { StudentNames } from "@/components/staff/student-names";
import { ScoreSheetManager } from "@/components/staff/score-sheet-manager";
import { ReportGenerator } from "@/components/staff/report-generator";

export default function StaffDashboard() {
  const { user } = useAuthStore();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!user) {
      setLocation("/");
    }
  }, [user, setLocation]);

  const { data: bootstrapData, isLoading } = useGetBootstrap();

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">My Score Sheets</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {bootstrapData?.scoreSheets?.filter(s => s.staffId === user?.id).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">My Reports</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {bootstrapData?.reports?.filter(s => s.createdBy === user?.id).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Student Names</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{bootstrapData?.studentNames?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="score-sheets" className="space-y-4">
        <TabsList>
          <TabsTrigger value="score-sheets">Score Sheets</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="students">Student Names</TabsTrigger>
        </TabsList>
        <TabsContent value="score-sheets">
          <Card>
            <CardContent className="pt-6">
              <ScoreSheetManager 
                scoreSheets={bootstrapData?.scoreSheets?.filter(s => s.staffId === user?.id) || []} 
                studentNames={bootstrapData?.studentNames || []}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="reports">
          <Card>
            <CardContent className="pt-6">
              <ReportGenerator 
                reports={bootstrapData?.reports || []} 
                scoreSheets={bootstrapData?.scoreSheets || []}
                studentNames={bootstrapData?.studentNames || []}
                schoolInfo={bootstrapData?.school!}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="students">
          <Card>
            <CardContent className="pt-6">
              <StudentNames studentNames={bootstrapData?.studentNames || []} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}


// ============================================================
// FILE: artifacts/quality-school-sis/vite.config.ts
// ============================================================

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});


// ============================================================
// FILE: lib/api-client-react/src/generated/api.schemas.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
export interface HealthStatus {
  status: string;
}

export type Role = (typeof Role)[keyof typeof Role];

export const Role = {
  admin: "admin",
  staff: "staff",
} as const;

export interface User {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: Role;
}

export interface UserInput {
  username: string;
  password: string;
  displayName: string;
  role: Role;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  ok: boolean;
  message: string;
  user: User | null;
}

export interface StudentName {
  id: string;
  name: string;
  createdBy: string;
}

export interface StudentNameInput {
  name: string;
  createdBy: string;
}

export interface ScoreRow {
  studentName: string;
  ca: number;
  exam: number;
  total: number;
  position: string;
}

export type ScoreSheetStatus =
  (typeof ScoreSheetStatus)[keyof typeof ScoreSheetStatus];

export const ScoreSheetStatus = {
  draft: "draft",
  submitted: "submitted",
} as const;

export interface ScoreSheet {
  id: string;
  title: string;
  subject: string;
  className: string;
  term: string;
  session: string;
  staffId: string;
  status: ScoreSheetStatus;
  rows: ScoreRow[];
  createdAt: string;
}

export type ScoreSheetInputStatus =
  (typeof ScoreSheetInputStatus)[keyof typeof ScoreSheetInputStatus];

export const ScoreSheetInputStatus = {
  draft: "draft",
  submitted: "submitted",
} as const;

export interface ScoreSheetInput {
  title: string;
  subject: string;
  className: string;
  term: string;
  session: string;
  staffId: string;
  status: ScoreSheetInputStatus;
  rows: ScoreRow[];
}

export interface ReportSubject {
  subject: string;
  ca: number;
  exam: number;
  total: number;
  grade: string;
  remark: string;
}

export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const ReportStatus = {
  draft: "draft",
  submitted: "submitted",
} as const;

export interface Report {
  id: string;
  studentName: string;
  className: string;
  term: string;
  session: string;
  position: string;
  attendance: string;
  nextTermBegins: string;
  teacherComment: string;
  principalComment: string;
  createdBy: string;
  submittedByRole: Role;
  status: ReportStatus;
  subjects: ReportSubject[];
  createdAt: string;
}

export type ReportInputStatus =
  (typeof ReportInputStatus)[keyof typeof ReportInputStatus];

export const ReportInputStatus = {
  draft: "draft",
  submitted: "submitted",
} as const;

export interface ReportInput {
  studentName: string;
  className: string;
  term: string;
  session: string;
  position: string;
  attendance: string;
  nextTermBegins: string;
  teacherComment: string;
  principalComment: string;
  createdBy: string;
  submittedByRole: Role;
  status: ReportInputStatus;
  subjects: ReportSubject[];
}

export interface SchoolInfo {
  title: string;
  subtitle: string;
  address: string;
  motto: string;
}

export interface AppState {
  school: SchoolInfo;
  users: User[];
  studentNames: StudentName[];
  scoreSheets: ScoreSheet[];
  reports: Report[];
}


// ============================================================
// FILE: lib/api-client-react/src/generated/api.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MutationFunction,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";

import type {
  AppState,
  HealthStatus,
  LoginRequest,
  LoginResponse,
  ReportInput,
  ScoreSheetInput,
  StudentNameInput,
  UserInput,
} from "./api.schemas";

import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";

type AwaitedInput<T> = PromiseLike<T> | T;

type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;

type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

/**
 * Returns server health status
 * @summary Health check
 */
export const getHealthCheckUrl = () => {
  return `/api/healthz`;
};

export const healthCheck = async (
  options?: RequestInit,
): Promise<HealthStatus> => {
  return customFetch<HealthStatus>(getHealthCheckUrl(), {
    ...options,
    method: "GET",
  });
};

export const getHealthCheckQueryKey = () => {
  return [`/api/healthz`] as const;
};

export const getHealthCheckQueryOptions = <
  TData = Awaited<ReturnType<typeof healthCheck>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getHealthCheckQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof healthCheck>>> = ({
    signal,
  }) => healthCheck({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type HealthCheckQueryResult = NonNullable<
  Awaited<ReturnType<typeof healthCheck>>
>;
export type HealthCheckQueryError = ErrorType<unknown>;

/**
 * @summary Health check
 */

export function useHealthCheck<
  TData = Awaited<ReturnType<typeof healthCheck>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getHealthCheckQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get complete SIS state
 */
export const getGetBootstrapUrl = () => {
  return `/api/sis/bootstrap`;
};

export const getBootstrap = async (
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getGetBootstrapUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetBootstrapQueryKey = () => {
  return [`/api/sis/bootstrap`] as const;
};

export const getGetBootstrapQueryOptions = <
  TData = Awaited<ReturnType<typeof getBootstrap>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getBootstrap>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetBootstrapQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getBootstrap>>> = ({
    signal,
  }) => getBootstrap({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getBootstrap>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetBootstrapQueryResult = NonNullable<
  Awaited<ReturnType<typeof getBootstrap>>
>;
export type GetBootstrapQueryError = ErrorType<unknown>;

/**
 * @summary Get complete SIS state
 */

export function useGetBootstrap<
  TData = Awaited<ReturnType<typeof getBootstrap>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getBootstrap>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetBootstrapQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Log in an admin or staff user
 */
export const getLoginUserUrl = () => {
  return `/api/sis/login`;
};

export const loginUser = async (
  loginRequest: LoginRequest,
  options?: RequestInit,
): Promise<LoginResponse> => {
  return customFetch<LoginResponse>(getLoginUserUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(loginRequest),
  });
};

export const getLoginUserMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof loginUser>>,
    TError,
    { data: BodyType<LoginRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof loginUser>>,
  TError,
  { data: BodyType<LoginRequest> },
  TContext
> => {
  const mutationKey = ["loginUser"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof loginUser>>,
    { data: BodyType<LoginRequest> }
  > = (props) => {
    const { data } = props ?? {};

    return loginUser(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type LoginUserMutationResult = NonNullable<
  Awaited<ReturnType<typeof loginUser>>
>;
export type LoginUserMutationBody = BodyType<LoginRequest>;
export type LoginUserMutationError = ErrorType<unknown>;

/**
 * @summary Log in an admin or staff user
 */
export const useLoginUser = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof loginUser>>,
    TError,
    { data: BodyType<LoginRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof loginUser>>,
  TError,
  { data: BodyType<LoginRequest> },
  TContext
> => {
  return useMutation(getLoginUserMutationOptions(options));
};

/**
 * @summary Create a user account
 */
export const getCreateUserUrl = () => {
  return `/api/sis/users`;
};

export const createUser = async (
  userInput: UserInput,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getCreateUserUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(userInput),
  });
};

export const getCreateUserMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createUser>>,
    TError,
    { data: BodyType<UserInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createUser>>,
  TError,
  { data: BodyType<UserInput> },
  TContext
> => {
  const mutationKey = ["createUser"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createUser>>,
    { data: BodyType<UserInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createUser(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateUserMutationResult = NonNullable<
  Awaited<ReturnType<typeof createUser>>
>;
export type CreateUserMutationBody = BodyType<UserInput>;
export type CreateUserMutationError = ErrorType<unknown>;

/**
 * @summary Create a user account
 */
export const useCreateUser = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createUser>>,
    TError,
    { data: BodyType<UserInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createUser>>,
  TError,
  { data: BodyType<UserInput> },
  TContext
> => {
  return useMutation(getCreateUserMutationOptions(options));
};

/**
 * @summary Update a user account
 */
export const getUpdateUserUrl = (id: string) => {
  return `/api/sis/users/${id}`;
};

export const updateUser = async (
  id: string,
  userInput: UserInput,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getUpdateUserUrl(id), {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(userInput),
  });
};

export const getUpdateUserMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateUser>>,
    TError,
    { id: string; data: BodyType<UserInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateUser>>,
  TError,
  { id: string; data: BodyType<UserInput> },
  TContext
> => {
  const mutationKey = ["updateUser"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateUser>>,
    { id: string; data: BodyType<UserInput> }
  > = (props) => {
    const { id, data } = props ?? {};

    return updateUser(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateUserMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateUser>>
>;
export type UpdateUserMutationBody = BodyType<UserInput>;
export type UpdateUserMutationError = ErrorType<unknown>;

/**
 * @summary Update a user account
 */
export const useUpdateUser = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateUser>>,
    TError,
    { id: string; data: BodyType<UserInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateUser>>,
  TError,
  { id: string; data: BodyType<UserInput> },
  TContext
> => {
  return useMutation(getUpdateUserMutationOptions(options));
};

/**
 * @summary Delete a user account
 */
export const getDeleteUserUrl = (id: string) => {
  return `/api/sis/users/${id}`;
};

export const deleteUser = async (
  id: string,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getDeleteUserUrl(id), {
    ...options,
    method: "DELETE",
  });
};

export const getDeleteUserMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteUser>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof deleteUser>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["deleteUser"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteUser>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return deleteUser(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type DeleteUserMutationResult = NonNullable<
  Awaited<ReturnType<typeof deleteUser>>
>;

export type DeleteUserMutationError = ErrorType<unknown>;

/**
 * @summary Delete a user account
 */
export const useDeleteUser = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteUser>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteUser>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getDeleteUserMutationOptions(options));
};

/**
 * @summary Save a student name
 */
export const getCreateStudentNameUrl = () => {
  return `/api/sis/student-names`;
};

export const createStudentName = async (
  studentNameInput: StudentNameInput,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getCreateStudentNameUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(studentNameInput),
  });
};

export const getCreateStudentNameMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createStudentName>>,
    TError,
    { data: BodyType<StudentNameInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createStudentName>>,
  TError,
  { data: BodyType<StudentNameInput> },
  TContext
> => {
  const mutationKey = ["createStudentName"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createStudentName>>,
    { data: BodyType<StudentNameInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createStudentName(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateStudentNameMutationResult = NonNullable<
  Awaited<ReturnType<typeof createStudentName>>
>;
export type CreateStudentNameMutationBody = BodyType<StudentNameInput>;
export type CreateStudentNameMutationError = ErrorType<unknown>;

/**
 * @summary Save a student name
 */
export const useCreateStudentName = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createStudentName>>,
    TError,
    { data: BodyType<StudentNameInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createStudentName>>,
  TError,
  { data: BodyType<StudentNameInput> },
  TContext
> => {
  return useMutation(getCreateStudentNameMutationOptions(options));
};

/**
 * @summary Delete a student name
 */
export const getDeleteStudentNameUrl = (id: string) => {
  return `/api/sis/student-names/${id}`;
};

export const deleteStudentName = async (
  id: string,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getDeleteStudentNameUrl(id), {
    ...options,
    method: "DELETE",
  });
};

export const getDeleteStudentNameMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteStudentName>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof deleteStudentName>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["deleteStudentName"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteStudentName>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return deleteStudentName(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type DeleteStudentNameMutationResult = NonNullable<
  Awaited<ReturnType<typeof deleteStudentName>>
>;

export type DeleteStudentNameMutationError = ErrorType<unknown>;

/**
 * @summary Delete a student name
 */
export const useDeleteStudentName = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteStudentName>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteStudentName>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getDeleteStudentNameMutationOptions(options));
};

/**
 * @summary Save or submit a score sheet
 */
export const getCreateScoreSheetUrl = () => {
  return `/api/sis/score-sheets`;
};

export const createScoreSheet = async (
  scoreSheetInput: ScoreSheetInput,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getCreateScoreSheetUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(scoreSheetInput),
  });
};

export const getCreateScoreSheetMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createScoreSheet>>,
    TError,
    { data: BodyType<ScoreSheetInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createScoreSheet>>,
  TError,
  { data: BodyType<ScoreSheetInput> },
  TContext
> => {
  const mutationKey = ["createScoreSheet"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createScoreSheet>>,
    { data: BodyType<ScoreSheetInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createScoreSheet(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateScoreSheetMutationResult = NonNullable<
  Awaited<ReturnType<typeof createScoreSheet>>
>;
export type CreateScoreSheetMutationBody = BodyType<ScoreSheetInput>;
export type CreateScoreSheetMutationError = ErrorType<unknown>;

/**
 * @summary Save or submit a score sheet
 */
export const useCreateScoreSheet = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createScoreSheet>>,
    TError,
    { data: BodyType<ScoreSheetInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createScoreSheet>>,
  TError,
  { data: BodyType<ScoreSheetInput> },
  TContext
> => {
  return useMutation(getCreateScoreSheetMutationOptions(options));
};

/**
 * @summary Update a score sheet
 */
export const getUpdateScoreSheetUrl = (id: string) => {
  return `/api/sis/score-sheets/${id}`;
};

export const updateScoreSheet = async (
  id: string,
  scoreSheetInput: ScoreSheetInput,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getUpdateScoreSheetUrl(id), {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(scoreSheetInput),
  });
};

export const getUpdateScoreSheetMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateScoreSheet>>,
    TError,
    { id: string; data: BodyType<ScoreSheetInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateScoreSheet>>,
  TError,
  { id: string; data: BodyType<ScoreSheetInput> },
  TContext
> => {
  const mutationKey = ["updateScoreSheet"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateScoreSheet>>,
    { id: string; data: BodyType<ScoreSheetInput> }
  > = (props) => {
    const { id, data } = props ?? {};

    return updateScoreSheet(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateScoreSheetMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateScoreSheet>>
>;
export type UpdateScoreSheetMutationBody = BodyType<ScoreSheetInput>;
export type UpdateScoreSheetMutationError = ErrorType<unknown>;

/**
 * @summary Update a score sheet
 */
export const useUpdateScoreSheet = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateScoreSheet>>,
    TError,
    { id: string; data: BodyType<ScoreSheetInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateScoreSheet>>,
  TError,
  { id: string; data: BodyType<ScoreSheetInput> },
  TContext
> => {
  return useMutation(getUpdateScoreSheetMutationOptions(options));
};

/**
 * @summary Delete a score sheet
 */
export const getDeleteScoreSheetUrl = (id: string) => {
  return `/api/sis/score-sheets/${id}`;
};

export const deleteScoreSheet = async (
  id: string,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getDeleteScoreSheetUrl(id), {
    ...options,
    method: "DELETE",
  });
};

export const getDeleteScoreSheetMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteScoreSheet>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof deleteScoreSheet>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["deleteScoreSheet"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteScoreSheet>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return deleteScoreSheet(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type DeleteScoreSheetMutationResult = NonNullable<
  Awaited<ReturnType<typeof deleteScoreSheet>>
>;

export type DeleteScoreSheetMutationError = ErrorType<unknown>;

/**
 * @summary Delete a score sheet
 */
export const useDeleteScoreSheet = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteScoreSheet>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteScoreSheet>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getDeleteScoreSheetMutationOptions(options));
};

/**
 * @summary Save or submit a student report
 */
export const getCreateReportUrl = () => {
  return `/api/sis/reports`;
};

export const createReport = async (
  reportInput: ReportInput,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getCreateReportUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(reportInput),
  });
};

export const getCreateReportMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createReport>>,
    TError,
    { data: BodyType<ReportInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createReport>>,
  TError,
  { data: BodyType<ReportInput> },
  TContext
> => {
  const mutationKey = ["createReport"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createReport>>,
    { data: BodyType<ReportInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createReport(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateReportMutationResult = NonNullable<
  Awaited<ReturnType<typeof createReport>>
>;
export type CreateReportMutationBody = BodyType<ReportInput>;
export type CreateReportMutationError = ErrorType<unknown>;

/**
 * @summary Save or submit a student report
 */
export const useCreateReport = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createReport>>,
    TError,
    { data: BodyType<ReportInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createReport>>,
  TError,
  { data: BodyType<ReportInput> },
  TContext
> => {
  return useMutation(getCreateReportMutationOptions(options));
};

/**
 * @summary Update a student report
 */
export const getUpdateReportUrl = (id: string) => {
  return `/api/sis/reports/${id}`;
};

export const updateReport = async (
  id: string,
  reportInput: ReportInput,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getUpdateReportUrl(id), {
    ...options,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(reportInput),
  });
};

export const getUpdateReportMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateReport>>,
    TError,
    { id: string; data: BodyType<ReportInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateReport>>,
  TError,
  { id: string; data: BodyType<ReportInput> },
  TContext
> => {
  const mutationKey = ["updateReport"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateReport>>,
    { id: string; data: BodyType<ReportInput> }
  > = (props) => {
    const { id, data } = props ?? {};

    return updateReport(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateReportMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateReport>>
>;
export type UpdateReportMutationBody = BodyType<ReportInput>;
export type UpdateReportMutationError = ErrorType<unknown>;

/**
 * @summary Update a student report
 */
export const useUpdateReport = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateReport>>,
    TError,
    { id: string; data: BodyType<ReportInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateReport>>,
  TError,
  { id: string; data: BodyType<ReportInput> },
  TContext
> => {
  return useMutation(getUpdateReportMutationOptions(options));
};

/**
 * @summary Delete a report
 */
export const getDeleteReportUrl = (id: string) => {
  return `/api/sis/reports/${id}`;
};

export const deleteReport = async (
  id: string,
  options?: RequestInit,
): Promise<AppState> => {
  return customFetch<AppState>(getDeleteReportUrl(id), {
    ...options,
    method: "DELETE",
  });
};

export const getDeleteReportMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteReport>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof deleteReport>>,
  TError,
  { id: string },
  TContext
> => {
  const mutationKey = ["deleteReport"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteReport>>,
    { id: string }
  > = (props) => {
    const { id } = props ?? {};

    return deleteReport(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type DeleteReportMutationResult = NonNullable<
  Awaited<ReturnType<typeof deleteReport>>
>;

export type DeleteReportMutationError = ErrorType<unknown>;

/**
 * @summary Delete a report
 */
export const useDeleteReport = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteReport>>,
    TError,
    { id: string },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteReport>>,
  TError,
  { id: string },
  TContext
> => {
  return useMutation(getDeleteReportMutationOptions(options));
};


// ============================================================
// FILE: lib/api-zod/src/generated/api.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import * as zod from "zod";

/**
 * Returns server health status
 * @summary Health check
 */
export const HealthCheckResponse = zod.object({
  status: zod.string(),
});

/**
 * @summary Get complete SIS state
 */
export const GetBootstrapResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Log in an admin or staff user
 */
export const LoginUserBody = zod.object({
  username: zod.string(),
  password: zod.string(),
});

export const LoginUserResponse = zod.object({
  ok: zod.boolean(),
  message: zod.string(),
  user: zod.union([
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
    zod.null(),
  ]),
});

/**
 * @summary Create a user account
 */
export const CreateUserBody = zod.object({
  username: zod.string(),
  password: zod.string(),
  displayName: zod.string(),
  role: zod.enum(["admin", "staff"]),
});

export const CreateUserResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Update a user account
 */
export const UpdateUserParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateUserBody = zod.object({
  username: zod.string(),
  password: zod.string(),
  displayName: zod.string(),
  role: zod.enum(["admin", "staff"]),
});

export const UpdateUserResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Delete a user account
 */
export const DeleteUserParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteUserResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Save a student name
 */
export const CreateStudentNameBody = zod.object({
  name: zod.string(),
  createdBy: zod.string(),
});

export const CreateStudentNameResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Delete a student name
 */
export const DeleteStudentNameParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteStudentNameResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Save or submit a score sheet
 */
export const CreateScoreSheetBody = zod.object({
  title: zod.string(),
  subject: zod.string(),
  className: zod.string(),
  term: zod.string(),
  session: zod.string(),
  staffId: zod.string(),
  status: zod.enum(["draft", "submitted"]),
  rows: zod.array(
    zod.object({
      studentName: zod.string(),
      ca: zod.number(),
      exam: zod.number(),
      total: zod.number(),
      position: zod.string(),
    }),
  ),
});

export const CreateScoreSheetResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Update a score sheet
 */
export const UpdateScoreSheetParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateScoreSheetBody = zod.object({
  title: zod.string(),
  subject: zod.string(),
  className: zod.string(),
  term: zod.string(),
  session: zod.string(),
  staffId: zod.string(),
  status: zod.enum(["draft", "submitted"]),
  rows: zod.array(
    zod.object({
      studentName: zod.string(),
      ca: zod.number(),
      exam: zod.number(),
      total: zod.number(),
      position: zod.string(),
    }),
  ),
});

export const UpdateScoreSheetResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Delete a score sheet
 */
export const DeleteScoreSheetParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteScoreSheetResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Save or submit a student report
 */
export const CreateReportBody = zod.object({
  studentName: zod.string(),
  className: zod.string(),
  term: zod.string(),
  session: zod.string(),
  position: zod.string(),
  attendance: zod.string(),
  nextTermBegins: zod.string(),
  teacherComment: zod.string(),
  principalComment: zod.string(),
  createdBy: zod.string(),
  submittedByRole: zod.enum(["admin", "staff"]),
  status: zod.enum(["draft", "submitted"]),
  subjects: zod.array(
    zod.object({
      subject: zod.string(),
      ca: zod.number(),
      exam: zod.number(),
      total: zod.number(),
      grade: zod.string(),
      remark: zod.string(),
    }),
  ),
});

export const CreateReportResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Update a student report
 */
export const UpdateReportParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateReportBody = zod.object({
  studentName: zod.string(),
  className: zod.string(),
  term: zod.string(),
  session: zod.string(),
  position: zod.string(),
  attendance: zod.string(),
  nextTermBegins: zod.string(),
  teacherComment: zod.string(),
  principalComment: zod.string(),
  createdBy: zod.string(),
  submittedByRole: zod.enum(["admin", "staff"]),
  status: zod.enum(["draft", "submitted"]),
  subjects: zod.array(
    zod.object({
      subject: zod.string(),
      ca: zod.number(),
      exam: zod.number(),
      total: zod.number(),
      grade: zod.string(),
      remark: zod.string(),
    }),
  ),
});

export const UpdateReportResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});

/**
 * @summary Delete a report
 */
export const DeleteReportParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteReportResponse = zod.object({
  school: zod.object({
    title: zod.string(),
    subtitle: zod.string(),
    address: zod.string(),
    motto: zod.string(),
  }),
  users: zod.array(
    zod.object({
      id: zod.string(),
      username: zod.string(),
      password: zod.string(),
      displayName: zod.string(),
      role: zod.enum(["admin", "staff"]),
    }),
  ),
  studentNames: zod.array(
    zod.object({
      id: zod.string(),
      name: zod.string(),
      createdBy: zod.string(),
    }),
  ),
  scoreSheets: zod.array(
    zod.object({
      id: zod.string(),
      title: zod.string(),
      subject: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      staffId: zod.string(),
      status: zod.enum(["draft", "submitted"]),
      rows: zod.array(
        zod.object({
          studentName: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          position: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
  reports: zod.array(
    zod.object({
      id: zod.string(),
      studentName: zod.string(),
      className: zod.string(),
      term: zod.string(),
      session: zod.string(),
      position: zod.string(),
      attendance: zod.string(),
      nextTermBegins: zod.string(),
      teacherComment: zod.string(),
      principalComment: zod.string(),
      createdBy: zod.string(),
      submittedByRole: zod.enum(["admin", "staff"]),
      status: zod.enum(["draft", "submitted"]),
      subjects: zod.array(
        zod.object({
          subject: zod.string(),
          ca: zod.number(),
          exam: zod.number(),
          total: zod.number(),
          grade: zod.string(),
          remark: zod.string(),
        }),
      ),
      createdAt: zod.string(),
    }),
  ),
});


// ============================================================
// FILE: lib/api-zod/src/generated/types/appState.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { Report } from "./report";
import type { SchoolInfo } from "./schoolInfo";
import type { ScoreSheet } from "./scoreSheet";
import type { StudentName } from "./studentName";
import type { User } from "./user";

export interface AppState {
  school: SchoolInfo;
  users: User[];
  studentNames: StudentName[];
  scoreSheets: ScoreSheet[];
  reports: Report[];
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/healthStatus.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface HealthStatus {
  status: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/index.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export * from "./appState";
export * from "./healthStatus";
export * from "./loginRequest";
export * from "./loginResponse";
export * from "./report";
export * from "./reportInput";
export * from "./reportInputStatus";
export * from "./reportStatus";
export * from "./reportSubject";
export * from "./role";
export * from "./schoolInfo";
export * from "./scoreRow";
export * from "./scoreSheet";
export * from "./scoreSheetInput";
export * from "./scoreSheetInputStatus";
export * from "./scoreSheetStatus";
export * from "./studentName";
export * from "./studentNameInput";
export * from "./user";
export * from "./userInput";


// ============================================================
// FILE: lib/api-zod/src/generated/types/loginRequest.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface LoginRequest {
  username: string;
  password: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/loginResponse.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { User } from "./user";

export interface LoginResponse {
  ok: boolean;
  message: string;
  user: User | null;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/report.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { ReportStatus } from "./reportStatus";
import type { ReportSubject } from "./reportSubject";
import type { Role } from "./role";

export interface Report {
  id: string;
  studentName: string;
  className: string;
  term: string;
  session: string;
  position: string;
  attendance: string;
  nextTermBegins: string;
  teacherComment: string;
  principalComment: string;
  createdBy: string;
  submittedByRole: Role;
  status: ReportStatus;
  subjects: ReportSubject[];
  createdAt: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/reportInput.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { ReportInputStatus } from "./reportInputStatus";
import type { ReportSubject } from "./reportSubject";
import type { Role } from "./role";

export interface ReportInput {
  studentName: string;
  className: string;
  term: string;
  session: string;
  position: string;
  attendance: string;
  nextTermBegins: string;
  teacherComment: string;
  principalComment: string;
  createdBy: string;
  submittedByRole: Role;
  status: ReportInputStatus;
  subjects: ReportSubject[];
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/reportInputStatus.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type ReportInputStatus =
  (typeof ReportInputStatus)[keyof typeof ReportInputStatus];

export const ReportInputStatus = {
  draft: "draft",
  submitted: "submitted",
} as const;


// ============================================================
// FILE: lib/api-zod/src/generated/types/reportStatus.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const ReportStatus = {
  draft: "draft",
  submitted: "submitted",
} as const;


// ============================================================
// FILE: lib/api-zod/src/generated/types/reportSubject.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface ReportSubject {
  subject: string;
  ca: number;
  exam: number;
  total: number;
  grade: string;
  remark: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/role.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type Role = (typeof Role)[keyof typeof Role];

export const Role = {
  admin: "admin",
  staff: "staff",
} as const;


// ============================================================
// FILE: lib/api-zod/src/generated/types/schoolInfo.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface SchoolInfo {
  title: string;
  subtitle: string;
  address: string;
  motto: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/scoreRow.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface ScoreRow {
  studentName: string;
  ca: number;
  exam: number;
  total: number;
  position: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/scoreSheet.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { ScoreRow } from "./scoreRow";
import type { ScoreSheetStatus } from "./scoreSheetStatus";

export interface ScoreSheet {
  id: string;
  title: string;
  subject: string;
  className: string;
  term: string;
  session: string;
  staffId: string;
  status: ScoreSheetStatus;
  rows: ScoreRow[];
  createdAt: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/scoreSheetInput.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { ScoreRow } from "./scoreRow";
import type { ScoreSheetInputStatus } from "./scoreSheetInputStatus";

export interface ScoreSheetInput {
  title: string;
  subject: string;
  className: string;
  term: string;
  session: string;
  staffId: string;
  status: ScoreSheetInputStatus;
  rows: ScoreRow[];
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/scoreSheetInputStatus.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type ScoreSheetInputStatus =
  (typeof ScoreSheetInputStatus)[keyof typeof ScoreSheetInputStatus];

export const ScoreSheetInputStatus = {
  draft: "draft",
  submitted: "submitted",
} as const;


// ============================================================
// FILE: lib/api-zod/src/generated/types/scoreSheetStatus.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export type ScoreSheetStatus =
  (typeof ScoreSheetStatus)[keyof typeof ScoreSheetStatus];

export const ScoreSheetStatus = {
  draft: "draft",
  submitted: "submitted",
} as const;


// ============================================================
// FILE: lib/api-zod/src/generated/types/studentName.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface StudentName {
  id: string;
  name: string;
  createdBy: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/studentNameInput.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */

export interface StudentNameInput {
  name: string;
  createdBy: string;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/user.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { Role } from "./role";

export interface User {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: Role;
}


// ============================================================
// FILE: lib/api-zod/src/generated/types/userInput.ts
// ============================================================

/**
 * Generated by orval v8.5.3 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
import type { Role } from "./role";

export interface UserInput {
  username: string;
  password: string;
  displayName: string;
  role: Role;
}

