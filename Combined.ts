// ============================================================
// FILE: main.tsx
// ============================================================

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);


// ============================================================
// FILE: App.tsx
// ============================================================

import { useEffect, useMemo, useState } from "react";

type Role = "admin" | "staff";
type Status = "draft" | "submitted";

type User = {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: Role;
};

type Student = {
  id: string;
  name: string;
  className: string;
};

type ScoreRow = {
  id: string;
  studentName: string;
  classScore: number;
  examScore: number;
  position: string;
  remarks: string;
};

type ScoreSheet = {
  id: string;
  title: string;
  subject: string;
  className: string;
  term: string;
  year: string;
  status: Status;
  rows: ScoreRow[];
  createdBy: string;
  createdAt: string;
};

type Report = {
  id: string;
  studentName: string;
  className: string;
  term: string;
  year: string;
  position: string;
  attendance: string;
  conduct: string;
  interest: string;
  teacherRemark: string;
  status: Status;
  subjects: ScoreRow[];
  createdBy: string;
  createdAt: string;
};

type Template = {
  uploaded: boolean;
  note: string;
  uploadedAt: string;
};

const defaultUsers: User[] = [
  { id: "admin-1", username: "admin", password: "admin123", displayName: "Administrator", role: "admin" },
  { id: "staff-1", username: "staff", password: "staff123", displayName: "Staff Member", role: "staff" },
];

const subjects = ["English Language", "Mathematics", "Integrated Science", "Social Studies", "Arabic", "Computing", "Creative Arts"];

const keys = {
  users: "qsc_users",
  currentUser: "qsc_current_user",
  students: "qsc_students",
  scoreSheets: "qsc_score_sheets",
  reports: "qsc_reports",
  reportTemplate: "qsc_report_template",
};

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function load<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function totalScore(row: ScoreRow) {
  return Math.round((Number(row.classScore || 0) + (Number(row.examScore || 0) / 100) * 70) * 10) / 10;
}

function scoreGrade(total: number) {
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  if (total >= 40) return "E";
  return "F";
}

function ordinal(position: number) {
  const remainder = position % 100;
  if (remainder >= 11 && remainder <= 13) return `${position}th`;
  switch (position % 10) {
    case 1:
      return `${position}st`;
    case 2:
      return `${position}nd`;
    case 3:
      return `${position}rd`;
    default:
      return `${position}th`;
  }
}

function scoreRemark(total: number) {
  if (total >= 80) return "EXCELLENT";
  if (total >= 70) return "VERY GOOD";
  if (total >= 60) return "GOOD";
  if (total >= 50) return "AVERAGE";
  return "NI, NEEDS improvement";
}

function rowsWithCalculatedResults(rows: ScoreRow[]) {
  const ranked = rows
    .filter((row) => row.studentName.trim())
    .map((row, index) => ({ row, index, total: totalScore(row) }))
    .sort((a, b) => b.total - a.total || a.index - b.index);
  const positions = new Map<string, string>();
  ranked.forEach((entry, index) => {
    positions.set(entry.row.id, ordinal(index + 1));
  });
  return rows.map((row) => {
    const total = totalScore(row);
    return {
      ...row,
      position: row.studentName.trim() ? positions.get(row.id) || "" : "",
      remarks: row.studentName.trim() ? scoreRemark(total) : "",
    };
  });
}

function Button({ children, onClick, type = "button", variant = "primary", disabled = false }: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const classes = {
    primary: "bg-blue-900 hover:bg-blue-800 text-white",
    secondary: "bg-emerald-700 hover:bg-emerald-600 text-white",
    danger: "bg-red-600 hover:bg-red-500 text-white",
    ghost: "bg-white hover:bg-gray-50 text-blue-900 border border-blue-200",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${classes[variant]} disabled:cursor-not-allowed disabled:opacity-50`}>
      {children}
    </button>
  );
}

function Field({ label, children, selector }: { label: string; children: React.ReactNode; selector?: string }) {
  return (
    <label className="block" data-selector={selector}>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-600">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100";

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const users = load<User[]>(keys.users, defaultUsers);
    if (!localStorage.getItem(keys.users)) save(keys.users, users);
    const match = users.find((user) => user.username.trim().toLowerCase() === username.trim().toLowerCase() && user.password === password);
    if (!match) {
      setError("Wrong username or password. Please check the latest username and password saved by admin.");
      return;
    }
    save(keys.currentUser, match);
    onLogin(match);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-slate-900 px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-[1.05fr_.95fr]">
          <section className="bg-blue-950 p-10">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-blue-200">Quality School Complex</p>
            <h1 className="mt-5 text-4xl font-black leading-tight">Student Information System</h1>
            <p className="mt-4 text-blue-100">Manage staff users, score sheets, student names, uploaded report templates, drafts, previews, and submitted reports from one place.</p>
          </section>
          <form onSubmit={submit} className="p-10 text-gray-900" data-selector="login-form">
            <h2 className="text-2xl font-black text-blue-950">Sign in</h2>
            <p className="mt-2 text-sm text-gray-500">Use the current username and password saved in user management.</p>
            <div className="mt-8 space-y-4">
              <Field label="Username" selector="login-username">
                <input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
              </Field>
              <Field label="Password" selector="login-password">
                <input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
              </Field>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
              <Button type="submit">Login</Button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

function Header({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-blue-800 bg-blue-950 px-5 py-4 text-white shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-200">Quality School Complex</p>
          <h1 className="text-xl font-black">{user.role === "admin" ? "Admin Dashboard" : "Staff Dashboard"}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right text-sm sm:block">
            <p className="font-bold">{user.displayName}</p>
            <p className="capitalize text-blue-200">{user.role}</p>
          </div>
          <Button onClick={onLogout} variant="ghost">Sign Out</Button>
        </div>
      </div>
    </header>
  );
}

function Tabs({ tabs, active, setActive }: { tabs: { id: string; label: string }[]; active: string; setActive: (tab: string) => void }) {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-5">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActive(tab.id)} className={`whitespace-nowrap border-b-4 px-4 py-3 text-sm font-bold transition ${active === tab.id ? "border-blue-900 text-blue-900" : "border-transparent text-gray-500 hover:text-blue-900"}`} data-selector={`tab-${tab.id}`}>
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function StudentNamesSection({ refreshKey }: { refreshKey: number }) {
  const [students, setStudents] = useState<Student[]>(() => load(keys.students, []));
  const [name, setName] = useState("");
  const [className, setClassName] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const filteredStudents = useMemo(() => students.filter((student) => student.name.toLowerCase().includes(studentSearch.trim().toLowerCase())), [students, studentSearch]);

  useEffect(() => {
    setStudents(load(keys.students, []));
  }, [refreshKey]);

  function addStudent(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const next = [...students, { id: id("student"), name: name.trim(), className: className.trim() }];
    setStudents(next);
    save(keys.students, next);
    setName("");
    setClassName("");
  }

  function removeStudent(studentId: string) {
    const next = students.filter((student) => student.id !== studentId);
    setStudents(next);
    save(keys.students, next);
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-selector="staff-student-names-section">
      <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-black text-gray-900">Student Names</h2>
          <p className="text-sm text-gray-500">Saved names automatically appear in score sheets and the student name selector in create report.</p>
        </div>
      </div>
      <form onSubmit={addStudent} className="grid gap-3 md:grid-cols-[1fr_180px_auto]" data-selector="add-student-name-form">
        <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Student full name" data-selector="student-name-input" />
        <input className={inputClass} value={className} onChange={(event) => setClassName(event.target.value)} placeholder="Class" data-selector="student-class-input" />
        <Button type="submit">Save Student</Button>
      </form>
      <div className="mt-4 max-w-md">
        <Field label="Search Student Name">
          <input className={inputClass} type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search student name" data-selector="student-name-search" />
        </Field>
      </div>
      <div className="mt-5 grid gap-2 md:grid-cols-2">
        {filteredStudents.map((student) => (
          <div key={student.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <div>
              <p className="font-bold text-gray-900">{student.name}</p>
              <p className="text-xs text-gray-500">{student.className || "Class not set"}</p>
            </div>
            <button onClick={() => removeStudent(student.id)} className="text-sm font-bold text-red-600">Remove</button>
          </div>
        ))}
        {!students.length && <p className="text-sm text-gray-500">No student names saved yet.</p>}
        {!!students.length && !filteredStudents.length && <p className="text-sm text-gray-500">No student matches your search.</p>}
      </div>
    </section>
  );
}

function collectStudentNames() {
  const savedStudents = load<Student[]>(keys.students, []).map((student) => ({ name: student.name, className: student.className }));
  const fromSheets = load<ScoreSheet[]>(keys.scoreSheets, []).flatMap((sheet) => sheet.rows.map((row) => ({ name: row.studentName, className: sheet.className })));
  const map = new Map<string, { name: string; className: string }>();
  [...savedStudents, ...fromSheets].forEach((student) => {
    if (student.name) map.set(student.name.toLowerCase(), student);
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function ScoreSheetForm({ user, onSaved, editing }: { user: User; onSaved: () => void; editing?: ScoreSheet }) {
  const studentOptions = collectStudentNames();
  const [title, setTitle] = useState(editing?.title || "End of Term Score Sheet");
  const [subject, setSubject] = useState(editing?.subject || subjects[0]);
  const [className, setClassName] = useState(editing?.className || "");
  const [term, setTerm] = useState(editing?.term || "First Term");
  const [year, setYear] = useState(editing?.year || new Date().getFullYear().toString());
  const [rows, setRows] = useState<ScoreRow[]>(editing?.rows || studentOptions.slice(0, 8).map((student) => ({ id: id("row"), studentName: student.name, classScore: 0, examScore: 0, position: "", remarks: "" })));
  const [preview, setPreview] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const calculatedRows = useMemo(() => rowsWithCalculatedResults(rows), [rows]);
  const filteredStudentOptions = useMemo(() => studentOptions.filter((student) => student.name.toLowerCase().includes(studentSearch.trim().toLowerCase())), [studentOptions, studentSearch]);

  function updateRow(rowId: string, updates: Partial<ScoreRow>) {
    setRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...updates } : row)));
  }

  function addRow() {
    setRows((current) => [...current, { id: id("row"), studentName: "", classScore: 0, examScore: 0, position: "", remarks: "" }]);
  }

  function persist(status: Status) {
    const sheet: ScoreSheet = {
      id: editing?.id || id("sheet"),
      title,
      subject,
      className,
      term,
      year,
      rows: rowsWithCalculatedResults(rows).filter((row) => row.studentName.trim()),
      status,
      createdBy: user.displayName,
      createdAt: editing?.createdAt || new Date().toISOString(),
    };
    const sheets = load<ScoreSheet[]>(keys.scoreSheets, []);
    const next = sheets.some((item) => item.id === sheet.id) ? sheets.map((item) => (item.id === sheet.id ? sheet : item)) : [sheet, ...sheets];
    save(keys.scoreSheets, next);
    setSavedMessage(status === "draft" ? "Draft saved successfully." : "Score sheet submitted successfully.");
    onSaved();
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-selector="staff-score-sheet-form">
      <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h2 className="text-lg font-black text-gray-900">Staff Score Sheet</h2>
          <p className="text-sm text-gray-500">A4 sheet size preview and print layout. Use Save as Draft, Preview, or Submit.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => persist("draft")} variant="ghost">Save as Draft</Button>
          <Button onClick={() => setPreview(true)} variant="secondary">Preview</Button>
          <Button onClick={() => persist("submitted")}>Submit</Button>
        </div>
      </div>
      {savedMessage && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{savedMessage}</p>}
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="Sheet Title"><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="Subject"><select className={inputClass} value={subject} onChange={(event) => setSubject(event.target.value)}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Class"><input className={inputClass} value={className} onChange={(event) => setClassName(event.target.value)} /></Field>
        <Field label="Term"><input className={inputClass} value={term} onChange={(event) => setTerm(event.target.value)} /></Field>
        <Field label="Year"><input className={inputClass} value={year} onChange={(event) => setYear(event.target.value)} /></Field>
      </div>
      <div className="mt-5 max-w-md">
        <Field label="Search Student Name">
          <input className={inputClass} type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search student name" data-selector="score-sheet-student-search" />
        </Field>
      </div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[900px] border-collapse text-sm" data-selector="score-sheet-table">
          <thead className="bg-blue-50 text-xs uppercase text-blue-950">
            <tr>
              <th className="border border-gray-200 px-2 py-2">No.</th>
              <th className="border border-gray-200 px-2 py-2 text-left">Student Name</th>
              <th className="border border-gray-200 px-2 py-2">Class Score (30%)</th>
              <th className="border border-gray-200 px-2 py-2">Exam Score (100)</th>
              <th className="border border-gray-200 px-2 py-2">Total Score (100%)</th>
              <th className="border border-gray-200 px-2 py-2">Position</th>
              <th className="border border-gray-200 px-2 py-2">Grade</th>
              <th className="border border-gray-200 px-2 py-2">Remarks</th>
              <th className="border border-gray-200 px-2 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {calculatedRows.map((row, index) => {
              const total = totalScore(row);
              return (
                <tr key={row.id}>
                  <td className="border border-gray-200 px-2 py-2 text-center">{index + 1}</td>
                  <td className="border border-gray-200 px-2 py-2">
                    <select className={inputClass} value={row.studentName} onChange={(event) => updateRow(row.id, { studentName: event.target.value })} data-selector="score-sheet-student-name-select">
                      <option value="">Select student</option>
                      {filteredStudentOptions.map((student) => <option key={student.name} value={student.name}>{student.name}</option>)}
                    </select>
                  </td>
                  <td className="border border-gray-200 px-2 py-2"><input className={inputClass} type="number" value={row.classScore} onChange={(event) => updateRow(row.id, { classScore: Number(event.target.value) })} /></td>
                  <td className="border border-gray-200 px-2 py-2"><input className={inputClass} type="number" value={row.examScore} onChange={(event) => updateRow(row.id, { examScore: Number(event.target.value) })} /></td>
                  <td className="border border-gray-200 px-2 py-2 text-center font-bold">{total}</td>
                  <td className="border border-gray-200 px-2 py-2 text-center font-bold">{row.position}</td>
                  <td className="border border-gray-200 px-2 py-2 text-center font-bold">{scoreGrade(total)}</td>
                  <td className="border border-gray-200 px-2 py-2 font-semibold">{row.remarks}</td>
                  <td className="border border-gray-200 px-2 py-2 text-center"><button className="font-bold text-red-600" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4"><Button onClick={addRow} variant="ghost">Add Row</Button></div>
      {preview && <ScoreSheetPreview sheet={{ id: "preview", title, subject, className, term, year, rows: calculatedRows, status: "draft", createdBy: user.displayName, createdAt: new Date().toISOString() }} onClose={() => setPreview(false)} />}
    </section>
  );
}

function ScoreSheetPreview({ sheet, onClose }: { sheet: ScoreSheet; onClose: () => void }) {
  function print() {
    window.print();
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4" data-selector="score-sheet-preview-modal">
      <div className="mx-auto max-w-6xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex justify-end gap-2 print:hidden">
          <Button onClick={print}>Print / Save PDF</Button>
          <Button onClick={onClose} variant="ghost">Close</Button>
        </div>
        <div className="score-a4 mx-auto bg-white p-6 text-black shadow-xl print:shadow-none" data-selector="staff-score-sheet-a4">
          <div className="text-center">
            <h2 className="text-xl font-black text-blue-950">QUALITY SCHOOL COMPLEX</h2>
            <p className="font-bold">ENGLISH AND ARABIC</p>
            <p className="text-sm">{sheet.title}</p>
          </div>
          <div className="my-4 grid grid-cols-2 gap-2 text-sm">
            <p><strong>Subject:</strong> {sheet.subject}</p>
            <p><strong>Class:</strong> {sheet.className}</p>
            <p><strong>Term:</strong> {sheet.term}</p>
            <p><strong>Year:</strong> {sheet.year}</p>
          </div>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-blue-100">
                {['No.', 'Student Name', 'Class Score (30%)', 'Exam Score (100)', 'Total Score (100%)', 'Position', 'Grade', 'Remarks'].map((header) => <th key={header} className="border border-gray-500 px-2 py-1">{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, index) => <tr key={row.id}><td className="border border-gray-500 px-2 py-1 text-center">{index + 1}</td><td className="border border-gray-500 px-2 py-1">{row.studentName}</td><td className="border border-gray-500 px-2 py-1 text-center">{row.classScore}</td><td className="border border-gray-500 px-2 py-1 text-center">{row.examScore}</td><td className="border border-gray-500 px-2 py-1 text-center">{totalScore(row)}</td><td className="border border-gray-500 px-2 py-1 text-center">{row.position}</td><td className="border border-gray-500 px-2 py-1 text-center">{scoreGrade(totalScore(row))}</td><td className="border border-gray-500 px-2 py-1">{row.remarks}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ScoreSheetsList({ refreshKey }: { refreshKey: number }) {
  const [sheets, setSheets] = useState<ScoreSheet[]>(() => load(keys.scoreSheets, []));
  function refresh() { setSheets(load(keys.scoreSheets, [])); }
  useEffect(() => {
    refresh();
  }, [refreshKey]);
  function remove(sheetId: string) {
    const next = sheets.filter((sheet) => sheet.id !== sheetId);
    setSheets(next);
    save(keys.scoreSheets, next);
  }
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-selector="score-sheets-list">
      <h2 className="text-lg font-black text-gray-900">Saved Score Sheets</h2>
      <div className="mt-4 grid gap-3">
        {sheets.map((sheet) => (
          <div key={sheet.id} className="rounded-xl border border-gray-200 p-4">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <p className="font-black text-gray-900">{sheet.title}</p>
                <p className="text-sm text-gray-500">{sheet.subject} • {sheet.className || "No class"} • {sheet.term} • {sheet.status}</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => window.dispatchEvent(new CustomEvent("preview-sheet", { detail: sheet }))} variant="secondary">Preview</Button>
                <Button onClick={() => { remove(sheet.id); refresh(); }} variant="danger">Delete</Button>
              </div>
            </div>
          </div>
        ))}
        {!sheets.length && <p className="text-sm text-gray-500">No score sheets saved yet.</p>}
      </div>
    </section>
  );
}

function ReportForm({ user, isAdmin, onSaved }: { user: User; isAdmin: boolean; onSaved: () => void }) {
  const template = load<Template | null>(keys.reportTemplate, null);
  const names = collectStudentNames();
  const sheets = load<ScoreSheet[]>(keys.scoreSheets, []).filter((sheet) => sheet.status === "submitted" || sheet.status === "draft");
  const [studentName, setStudentName] = useState("");
  const [className, setClassName] = useState("");
  const [term, setTerm] = useState("First Term");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [position, setPosition] = useState("");
  const [attendance, setAttendance] = useState("");
  const [conduct, setConduct] = useState("");
  const [interest, setInterest] = useState("");
  const [teacherRemark, setTeacherRemark] = useState("");
  const [preview, setPreview] = useState<Report | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const filteredNames = useMemo(() => names.filter((student) => student.name.toLowerCase().includes(studentSearch.trim().toLowerCase())), [names, studentSearch]);

  const selectedSubjects = useMemo(() => {
    if (!studentName) return [];
    return sheets.flatMap((sheet) => rowsWithCalculatedResults(sheet.rows).filter((row) => row.studentName === studentName).map((row) => ({ ...row, id: `${sheet.id}-${row.id}`, studentName: sheet.subject })));
  }, [studentName, sheets]);

  useEffect(() => {
    const found = names.find((name) => name.name === studentName);
    setClassName(found?.className || className);
    const rowWithPosition = sheets.flatMap((sheet) => rowsWithCalculatedResults(sheet.rows)).find((row) => row.studentName === studentName && row.position);
    if (rowWithPosition) setPosition(rowWithPosition.position);
  }, [studentName]);

  if (!isAdmin && !template?.uploaded) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900" data-selector="staff-report-locked">
        <h2 className="text-lg font-black">Report unavailable</h2>
        <p className="mt-2 text-sm font-semibold">Admin must upload the report template before staff can access Create Report.</p>
      </section>
    );
  }

  function makeReport(status: Status): Report {
    return {
      id: id("report"),
      studentName,
      className,
      term,
      year,
      position,
      attendance,
      conduct,
      interest,
      teacherRemark,
      subjects: selectedSubjects,
      status,
      createdBy: user.displayName,
      createdAt: new Date().toISOString(),
    };
  }

  function persist(status: Status) {
    if (!studentName.trim() && !isAdmin) return;
    const report = makeReport(status);
    save(keys.reports, [report, ...load<Report[]>(keys.reports, [])]);
    setSavedMessage(status === "draft" ? "Draft saved successfully." : "Report submitted successfully.");
    onSaved();
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-selector={isAdmin ? "admin-generate-report-form" : "staff-create-report-form"}>
      <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h2 className="text-lg font-black text-gray-900">{isAdmin ? "Generate Report" : "Create Report"}</h2>
          <p className="text-sm text-gray-500">Student Name selects from score sheets and saved student names. Grade has been removed from the report table.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => persist("draft")} variant="ghost">Save as Draft</Button>
          <Button onClick={() => setPreview(makeReport("draft"))} variant="secondary">Preview</Button>
          <Button onClick={() => persist("submitted")}>Submit</Button>
        </div>
      </div>
      {savedMessage && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{savedMessage}</p>}
      {template?.uploaded && !isAdmin && <div className="mb-4 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><p className="font-bold">Uploaded report available</p><p>{template.note}</p><Button onClick={() => { const first = filteredNames[0]; if (first) { setStudentName(first.name); setClassName(first.className); } }} variant="ghost" disabled={!filteredNames.length}>Open and Import Student Details</Button></div>}
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Search Student Name">
          <input className={inputClass} type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search student name" data-selector="report-student-search" />
        </Field>
        <Field label="Student Name" selector="report-student-name">
          <select className={inputClass} value={studentName} onChange={(event) => setStudentName(event.target.value)} data-selector="report-student-name-select">
            <option value="">Select student from score sheets</option>
            {filteredNames.map((student) => <option key={student.name} value={student.name}>{student.name}</option>)}
          </select>
        </Field>
        <Field label="Class"><input className={inputClass} value={className} onChange={(event) => setClassName(event.target.value)} /></Field>
        <Field label="Term"><input className={inputClass} value={term} onChange={(event) => setTerm(event.target.value)} /></Field>
        <Field label="Year"><input className={inputClass} value={year} onChange={(event) => setYear(event.target.value)} /></Field>
        <Field label="Position"><input className={inputClass} value={position} onChange={(event) => setPosition(event.target.value)} /></Field>
        <Field label="Attendance"><input className={inputClass} value={attendance} onChange={(event) => setAttendance(event.target.value)} /></Field>
        <Field label="Conduct"><input className={inputClass} value={conduct} onChange={(event) => setConduct(event.target.value)} /></Field>
        <Field label="Interest"><input className={inputClass} value={interest} onChange={(event) => setInterest(event.target.value)} /></Field>
      </div>
      <Field label="Teacher Remark" selector="report-teacher-remark"><textarea className={`${inputClass} mt-3 min-h-24`} value={teacherRemark} onChange={(event) => setTeacherRemark(event.target.value)} /></Field>
      <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[720px] border-collapse text-sm" data-selector={isAdmin ? "admin-generate-report-table" : "staff-create-report-table"}>
          <thead className="bg-blue-50 text-xs uppercase text-blue-950">
            <tr>
              <th className="border border-gray-200 px-2 py-2 text-left">Subject</th>
              <th className="border border-gray-200 px-2 py-2">Class Score</th>
              <th className="border border-gray-200 px-2 py-2">Exam Score</th>
              <th className="border border-gray-200 px-2 py-2">Total</th>
              <th className="border border-gray-200 px-2 py-2">Position</th>
              <th className="border border-gray-200 px-2 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {selectedSubjects.map((row) => <tr key={row.id}><td className="border border-gray-200 px-2 py-2 font-bold">{row.studentName}</td><td className="border border-gray-200 px-2 py-2 text-center">{row.classScore}</td><td className="border border-gray-200 px-2 py-2 text-center">{row.examScore}</td><td className="border border-gray-200 px-2 py-2 text-center">{totalScore(row)}</td><td className="border border-gray-200 px-2 py-2 text-center">{row.position}</td><td className="border border-gray-200 px-2 py-2">{row.remarks}</td></tr>)}
            {!selectedSubjects.length && <tr><td colSpan={6} className="border border-gray-200 px-3 py-6 text-center text-gray-500">Select a student to upload results from score sheets automatically.</td></tr>}
          </tbody>
        </table>
      </div>
      {preview && <ReportPreview report={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function ReportPreview({ report, onClose }: { report: Report; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4" data-selector="report-preview-modal">
      <div className="mx-auto max-w-4xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex justify-end gap-2 print:hidden"><Button onClick={() => window.print()}>Print / Save PDF</Button><Button onClick={onClose} variant="ghost">Close</Button></div>
        <div className="report-a4 mx-auto bg-white p-7 text-black shadow-xl print:shadow-none" data-selector="report-a4-preview">
          <div className="border-b-2 border-blue-900 pb-2 text-center">
            <h2 className="text-[18px] font-black tracking-wide text-blue-950">QUALITY SCHOOL COMPLEX</h2>
            <p className="text-[13px] font-bold text-blue-950">ENGLISH AND ARABIC</p>
            <p className="text-[10px] font-semibold text-gray-600">LOCATION: KAKPAGYILI SAVANNA AREA - SAWALNI</p>
          </div>

          <div className="my-3 flex items-start justify-between text-[10px] leading-5">
            <div>
              <p><strong>Serial No.:</strong> ................................</p>
              <p><strong>Admission No.:</strong> ..........................</p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-16 w-24 items-center justify-center rounded border border-gray-300 text-[9px] font-bold text-gray-400">LOGO</div>
            </div>
            <div className="text-right">
              <p><strong>Term:</strong> {report.term || "........................"}</p>
              <p><strong>Year:</strong> {report.year || "........................"}</p>
            </div>
          </div>

          <div className="my-2 border-y border-gray-400 py-2 text-[10px] leading-5">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <p><strong>Name of Student:</strong> <span className="inline-block min-w-40 border-b border-black px-1">{report.studentName}</span></p>
              <p><strong>Class:</strong> <span className="inline-block min-w-28 border-b border-black px-1">{report.className}</span></p>
              <p><strong>Attendance:</strong> <span className="inline-block min-w-24 border-b border-black px-1">{report.attendance}</span></p>
              <p><strong>Position:</strong> <span className="inline-block min-w-24 border-b border-black px-1">{report.position}</span></p>
            </div>
          </div>

          <div className="my-2 border border-gray-400 bg-gray-100 px-2 py-1 text-[9px] font-bold">
            KEY: Class Score = 30%, Examination Score = 70%, Total Score = 100%
          </div>

          <table className="w-full border-collapse text-[10px]" data-selector="report-preview-table-no-grade">
            <thead>
              <tr className="bg-blue-100">
                <th className="border border-gray-600 px-2 py-1 text-left">Subject</th>
                <th className="border border-gray-600 px-2 py-1">Class Score</th>
                <th className="border border-gray-600 px-2 py-1">Exam Score</th>
                <th className="border border-gray-600 px-2 py-1">Total</th>
                <th className="border border-gray-600 px-2 py-1">Position</th>
                <th className="border border-gray-600 px-2 py-1">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {report.subjects.map((row) => (
                <tr key={row.id}>
                  <td className="border border-gray-600 px-2 py-1 text-left">{row.studentName}</td>
                  <td className="border border-gray-600 px-2 py-1 text-center">{row.classScore}</td>
                  <td className="border border-gray-600 px-2 py-1 text-center">{row.examScore}</td>
                  <td className="border border-gray-600 px-2 py-1 text-center">{totalScore(row)}</td>
                  <td className="border border-gray-600 px-2 py-1 text-center">{row.position}</td>
                  <td className="border border-gray-600 px-2 py-1">{row.remarks}</td>
                </tr>
              ))}
              {!report.subjects.length && (
                <tr>
                  <td className="border border-gray-600 px-2 py-6 text-center text-gray-500" colSpan={6}>No score sheet results selected.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-3 space-y-2 text-[10px] leading-5">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <p><strong>Conduct:</strong> <span className="inline-block min-w-32 border-b border-black px-1">{report.conduct}</span></p>
              <p><strong>Interest:</strong> <span className="inline-block min-w-32 border-b border-black px-1">{report.interest}</span></p>
              <p><strong>Promoted to:</strong> <span className="inline-block min-w-32 border-b border-black px-1"></span></p>
              <p><strong>Next Term Begins:</strong> <span className="inline-block min-w-32 border-b border-black px-1"></span></p>
            </div>
            <p><strong>Teacher's Remark:</strong> <span className="inline-block min-w-[70%] border-b border-black px-1">{report.teacherRemark}</span></p>
            <p><strong>Headmaster's Signature:</strong> <span className="inline-block min-w-[65%] border-b border-black px-1"></span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportsList({ isAdmin }: { isAdmin: boolean }) {
  const [reports, setReports] = useState<Report[]>(() => load(keys.reports, []));
  const [preview, setPreview] = useState<Report | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const filteredNames = useMemo(() => names.filter((student) => student.name.toLowerCase().includes(studentSearch.trim().toLowerCase())), [names, studentSearch]);
  function remove(reportId: string) {
    const next = reports.filter((report) => report.id !== reportId);
    setReports(next);
    save(keys.reports, next);
  }
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-selector={isAdmin ? "admin-reports-list" : "staff-reports-list"}>
      <h2 className="text-lg font-black text-gray-900">Reports</h2>
      <div className="mt-4 grid gap-3">
        {reports.map((report) => <div key={report.id} className="rounded-xl border border-gray-200 p-4"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><p className="font-black text-gray-900">{report.studentName || "Report template"}</p><p className="text-sm text-gray-500">{report.className} • {report.term} • Position: {report.position || "-"} • {report.status}</p></div><div className="flex gap-2"><Button onClick={() => setPreview(report)} variant="secondary">Preview</Button><Button onClick={() => remove(report.id)} variant="danger">Delete</Button></div></div></div>)}
        {!reports.length && <p className="text-sm text-gray-500">No reports found.</p>}
      </div>
      {preview && <ReportPreview report={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function TemplateUpload() {
  const [template, setTemplate] = useState<Template | null>(() => load(keys.reportTemplate, null));
  const [note, setNote] = useState(template?.note || "Quality School Complex approved report template");
  function upload() {
    const next = { uploaded: true, note, uploadedAt: new Date().toISOString() };
    save(keys.reportTemplate, next);
    setTemplate(next);
  }
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-selector="admin-report-upload-section">
      <h2 className="text-lg font-black text-gray-900">Upload Report Before Staff Access</h2>
      <p className="mt-1 text-sm text-gray-500">Staff cannot create reports until this report template is uploaded by admin. Once uploaded, it appears in the staff Create Report section for opening and importing student details.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Template note or name" data-selector="admin-report-template-input" />
        <Button onClick={upload}>Upload Report Template</Button>
      </div>
      {template?.uploaded && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">Uploaded: {template.note}</p>}
    </section>
  );
}

function UserManagement() {
  const [users, setUsers] = useState<User[]>(() => load(keys.users, defaultUsers));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: "", username: "", password: "", role: "staff" as Role });

  function persist(next: User[]) {
    setUsers(next);
    save(keys.users, next);
    const current = load<User | null>(keys.currentUser, null);
    if (current) {
      const refreshed = next.find((user) => user.id === current.id);
      if (refreshed) save(keys.currentUser, refreshed);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.username.trim() || !form.password.trim()) return;
    const duplicate = users.some((user) => user.username.trim().toLowerCase() === form.username.trim().toLowerCase() && user.id !== editingId);
    if (duplicate) return;
    if (editingId) {
      persist(users.map((user) => user.id === editingId ? { ...user, ...form } : user));
    } else {
      persist([...users, { id: id("user"), ...form }]);
    }
    setEditingId(null);
    setForm({ displayName: "", username: "", password: "", role: "staff" });
  }

  function edit(user: User) {
    setEditingId(user.id);
    setForm({ displayName: user.displayName, username: user.username, password: user.password, role: user.role });
  }

  function remove(userId: string) {
    const adminCount = users.filter((user) => user.role === "admin").length;
    const userToDelete = users.find((user) => user.id === userId);
    if (userToDelete?.role === "admin" && adminCount <= 1) return;
    const next = users.filter((user) => user.id !== userId);
    persist(next);
    const current = load<User | null>(keys.currentUser, null);
    if (current?.id === userId) localStorage.removeItem(keys.currentUser);
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-selector="admin-user-management">
      <h2 className="text-lg font-black text-gray-900">Manage Users</h2>
      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-5" data-selector="admin-add-user-form">
        <input className={inputClass} value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Display name" />
        <input className={inputClass} value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="Username" />
        <input className={inputClass} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" />
        <select className={inputClass} value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as Role }))}><option value="staff">Staff</option><option value="admin">Admin</option></select>
        <Button type="submit">{editingId ? "Save Changes" : "Add User"}</Button>
      </form>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {users.map((user) => <div key={user.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-4"><div><p className="font-black text-gray-900">{user.displayName}</p><p className="text-sm text-gray-500">{user.username} • {user.role}</p></div><div className="flex gap-2"><Button onClick={() => edit(user)} variant="ghost">Edit</Button><Button onClick={() => remove(user.id)} variant="danger" disabled={user.role === "admin" && users.filter((item) => item.role === "admin").length <= 1}>Delete</Button></div></div>)}
      </div>
    </section>
  );
}

function StaffDashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tab, setTab] = useState("students");
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewSheet, setPreviewSheet] = useState<ScoreSheet | null>(null);
  useEffect(() => {
    const handler = (event: Event) => setPreviewSheet((event as CustomEvent<ScoreSheet>).detail);
    window.addEventListener("preview-sheet", handler);
    return () => window.removeEventListener("preview-sheet", handler);
  }, []);
  return (
    <div className="min-h-screen bg-slate-100">
      <Header user={user} onLogout={onLogout} />
      <Tabs tabs={[{ id: "students", label: "Student Names" }, { id: "scores", label: "Score Sheets" }, { id: "reports", label: "Create Report" }]} active={tab} setActive={setTab} />
      <main className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        {tab === "students" && <StudentNamesSection refreshKey={refreshKey} />}
        {tab === "scores" && <><ScoreSheetForm user={user} onSaved={() => setRefreshKey((value) => value + 1)} /><ScoreSheetsList refreshKey={refreshKey} /></>}
        {tab === "reports" && <ReportForm user={user} isAdmin={false} onSaved={() => setTab("reports")} />}
      </main>
      {previewSheet && <ScoreSheetPreview sheet={previewSheet} onClose={() => setPreviewSheet(null)} />}
    </div>
  );
}

function AdminDashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tab, setTab] = useState("reports");
  return (
    <div className="min-h-screen bg-slate-100">
      <Header user={user} onLogout={onLogout} />
      <Tabs tabs={[{ id: "reports", label: "Reports" }, { id: "generate", label: "Generate Report" }, { id: "upload", label: "Upload Report" }, { id: "users", label: "Manage Users" }]} active={tab} setActive={setTab} />
      <main className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        {tab === "reports" && <ReportsList isAdmin />}
        {tab === "generate" && <ReportForm user={user} isAdmin onSaved={() => setTab("reports")} />}
        {tab === "upload" && <TemplateUpload />}
        {tab === "users" && <UserManagement />}
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => load(keys.currentUser, null));
  useEffect(() => {
    if (!localStorage.getItem(keys.users)) save(keys.users, defaultUsers);
  }, []);
  function logout() {
    localStorage.removeItem(keys.currentUser);
    setUser(null);
  }
  if (!user) return <Login onLogin={setUser} />;
  if (user.role === "admin") return <AdminDashboard user={user} onLogout={logout} />;
  return <StaffDashboard user={user} onLogout={logout} />;
}


// ============================================================
// FILE: index.css
// ============================================================

@import "tailwindcss";

:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #111827;
  background: #f1f5f9;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-height: 100%;
  margin: 0;
}

body {
  min-width: 320px;
  background: #f1f5f9;
}

button,
input,
select,
textarea {
  font: inherit;
}

.score-a4,
.report-a4 {
  width: 210mm;
  max-width: 100%;
  min-height: 297mm;
}

@media print {
  body {
    background: white;
  }

  body * {
    visibility: hidden;
  }

  .score-a4,
  .score-a4 *,
  .report-a4,
  .report-a4 * {
    visibility: visible;
  }

  .score-a4,
  .report-a4 {
    position: absolute;
    left: 0;
    top: 0;
    width: 210mm;
    min-height: 297mm;
    margin: 0;
    box-shadow: none;
  }

  .print\:hidden {
    display: none !important;
  }
}
