import { useState, useEffect } from "react";
import {
  getScoreSheets, saveScoreSheets, ScoreSheet, ScoreRow,
  getCurrentUser, getStudentNames, ordinal, calcExam70, calcTotal,
} from "@/lib/storage";

const SUBJECTS = ["English Language", "Mathematics", "Science", "Social Studies", "Religious & Moral Education", "Creative Arts", "French", "ICT", "Physical Education"];
const TERMS = ["Term 1", "Term 2", "Term 3"];
const CLASSES = ["Basic 1", "Basic 2", "Basic 3", "Basic 4", "Basic 5", "Basic 6", "JHS 1", "JHS 2", "JHS 3"];

function emptyRow(no: number): ScoreRow {
  return { no, studentName: "", classScore: "", exam100: "" };
}

const DEFAULT_ROWS = 20;

export default function ScoreSheetManager() {
  const user = getCurrentUser()!;
  const [sheets, setSheets] = useState<ScoreSheet[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [previewSheet, setPreviewSheet] = useState<ScoreSheet | null>(null);

  useEffect(() => { refresh(); }, []);
  function refresh() {
    setSheets(getScoreSheets().filter((s) => s.staffUsername === user.username));
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this score sheet?")) return;
    saveScoreSheets(getScoreSheets().filter((s) => s.id !== id));
    refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">My Score Sheets</h2>
          <p className="text-sm text-gray-500 mt-0.5">Create and manage your class score sheets</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-[#003087] hover:bg-[#002570] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Create Score Sheet
        </button>
      </div>

      {sheets.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <div className="text-5xl mb-3">📝</div>
          <p className="font-semibold text-gray-500">No score sheets yet</p>
          <p className="text-sm text-gray-400 mt-1">Create your first score sheet to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sheets.map((sheet) => (
            <div key={sheet.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm">{sheet.title}</span>
                    <StatusBadge status={sheet.status} />
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span>Subject: <strong className="text-gray-700">{sheet.subject}</strong></span>
                    <span>Class: <strong className="text-gray-700">{sheet.class}</strong></span>
                    <span>Term: <strong className="text-gray-700">{sheet.term}</strong></span>
                    <span>Students: <strong className="text-gray-700">{sheet.rows.filter((r) => r.studentName).length}</strong></span>
                    <span>Created: <strong className="text-gray-700">{new Date(sheet.createdAt).toLocaleDateString()}</strong></span>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setPreviewSheet(sheet)} className="bg-gray-100 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-200 transition">
                    Preview
                  </button>
                  {sheet.status === "draft" && (
                    <button
                      onClick={() => {
                        const all = getScoreSheets();
                        const idx = all.findIndex((s) => s.id === sheet.id);
                        if (idx >= 0) { all[idx].status = "submitted"; all[idx].submittedAt = new Date().toISOString(); }
                        saveScoreSheets(all); refresh();
                      }}
                      className="bg-green-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-green-700 transition"
                    >
                      Submit to Admin
                    </button>
                  )}
                  {sheet.status === "draft" && (
                    <button onClick={handleDelete.bind(null, sheet.id)} className="bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-red-100 transition">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateScoreSheetModal user={user} onClose={() => { setShowCreate(false); refresh(); }} />}
      {previewSheet && <ScoreSheetPreviewModal sheet={previewSheet} onClose={() => setPreviewSheet(null)} />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800",
    submitted: "bg-blue-100 text-blue-800",
    approved: "bg-green-100 text-green-800",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] || "bg-gray-100 text-gray-700"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function CreateScoreSheetModal({ user, onClose }: { user: ReturnType<typeof getCurrentUser>; onClose: () => void }) {
  const studentNames = getStudentNames();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    title: "",
    subject: "",
    class: "",
    term: "Term 1",
    academicYear: "2024/2025",
  });
  const [rows, setRows] = useState<ScoreRow[]>(
    Array.from({ length: DEFAULT_ROWS }, (_, i) => emptyRow(i + 1))
  );

  function setRow(i: number, field: keyof ScoreRow, val: string) {
    const updated = [...rows];
    updated[i] = { ...updated[i], [field]: val };
    setRows(updated);
  }

  const filteredRows = search
    ? rows.filter((r) => !r.studentName || r.studentName.toLowerCase().includes(search.toLowerCase()))
    : rows;

  function computeExam70(ex100: string) { return calcExam70(parseFloat(ex100) || 0); }
  function computeTotal(cs: string, ex100: string) {
    return calcTotal(parseFloat(cs) || 0, computeExam70(ex100));
  }

  function handleSave(status: "draft" | "submitted") {
    if (!form.title.trim() || !form.subject.trim() || !form.class.trim()) {
      alert("Please fill in Title, Subject and Class."); return;
    }
    const sheet: ScoreSheet = {
      id: "ss_" + Date.now(),
      ...form,
      rows: rows.filter((r) => r.studentName),
      status,
      staffUsername: user?.username || "",
      staffName: user?.displayName || user?.username || "",
      createdAt: new Date().toISOString(),
      submittedAt: status === "submitted" ? new Date().toISOString() : null,
      approvedAt: null,
    };
    const all = getScoreSheets();
    all.push(sheet);
    saveScoreSheets(all);
    onClose();
  }

  function handlePrint() {
    const rowsHtml = rows
      .filter((r) => r.studentName)
      .map((r, i) => {
        const ex70 = computeExam70(r.exam100);
        const total = computeTotal(r.classScore, r.exam100);
        return `<tr><td>${i + 1}</td><td style="text-align:left">${r.studentName}</td>
          <td>${r.classScore}</td><td>${r.exam100}</td><td>${ex70}</td>
          <td style="font-weight:bold">${total}</td></tr>`;
      }).join("");

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>${form.title}</title>
    <style>@page{size:A4 landscape;margin:10mm;}body{font-family:Arial,sans-serif;font-size:10px;}
    h2,h3{margin:0 0 4px;}table{width:100%;border-collapse:collapse;}
    th,td{border:1px solid #555;padding:3px 6px;text-align:center;}th{background:#dce8f5;}
    td:nth-child(2){text-align:left;}.meta{font-size:10px;margin-bottom:8px;}</style></head>
    <body>
    <h2>QUALITY SCHOOL COMPLEX</h2>
    <h3>${form.title}</h3>
    <div class="meta">Subject: ${form.subject} | Class: ${form.class} | Term: ${form.term} | Year: ${form.academicYear}</div>
    <table><thead><tr><th>#</th><th>Student Name</th><th>Class Score (30%)</th><th>Exam Score (100%)</th><th>Exam Score (70%)</th><th>Total</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>
    </body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 500);
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full" style={{ maxWidth: "210mm" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-900">Create Score Sheet</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl font-bold">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Sheet Title *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]" placeholder="e.g. End of Term Maths" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Subject *</label>
              <input list="subj-meta" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]" placeholder="Subject" />
              <datalist id="subj-meta">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Class *</label>
              <input list="class-meta" value={form.class} onChange={(e) => setForm({ ...form, class: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]" placeholder="Class" />
              <datalist id="class-meta">{CLASSES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Term</label>
              <select value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none">
                {TERMS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Academic Year</label>
              <input value={form.academicYear} onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none" />
            </div>
          </div>

          {/* Search */}
          <div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student names…"
              className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]"
            />
          </div>

          {/* Score Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#dce8f5]">
                  <th className="border border-gray-400 px-2 py-2 text-center w-10">#</th>
                  <th className="border border-gray-400 px-3 py-2 text-left min-w-48">Student Name</th>
                  <th className="border border-gray-400 px-3 py-2 text-center">Class Score (30%)</th>
                  <th className="border border-gray-400 px-3 py-2 text-center">Exam Score (100%)</th>
                  <th className="border border-gray-400 px-3 py-2 text-center">Exam Score (70%)</th>
                  <th className="border border-gray-400 px-3 py-2 text-center font-bold">Total</th>
                  <th className="border border-gray-400 px-3 py-2 text-center">Position</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  if (search && row.studentName && !row.studentName.toLowerCase().includes(search.toLowerCase())) return null;
                  const ex70 = row.exam100 ? computeExam70(row.exam100) : "";
                  const total = (row.classScore || row.exam100) ? computeTotal(row.classScore, row.exam100) : "";

                  // Compute ordinal position
                  const filledRows = rows.filter((r) => r.studentName && (r.classScore || r.exam100));
                  const sorted = filledRows.slice().sort((a, b) =>
                    computeTotal(b.classScore, b.exam100) - computeTotal(a.classScore, a.exam100)
                  );
                  const posIdx = sorted.findIndex((r) => r.no === row.no);
                  const posDisplay = posIdx >= 0 && row.studentName ? ordinal(posIdx + 1) : "";

                  return (
                    <tr key={row.no} className={row.no % 2 === 0 ? "bg-gray-50" : "bg-white"}>
                      <td className="border border-gray-300 px-2 py-1 text-center text-xs text-gray-500">{row.no}</td>
                      <td className="border border-gray-300 px-2 py-1">
                        <input
                          list="student-name-dl"
                          value={row.studentName}
                          onChange={(e) => setRow(i, "studentName", e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:border-[#003087] bg-transparent"
                          placeholder="Student name"
                        />
                      </td>
                      <td className="border border-gray-300 px-2 py-1">
                        <input type="number" value={row.classScore} onChange={(e) => setRow(i, "classScore", e.target.value)} min="0" max="30"
                          className="w-full px-2 py-1 text-sm border border-gray-200 rounded text-center focus:outline-none bg-transparent" />
                      </td>
                      <td className="border border-gray-300 px-2 py-1">
                        <input type="number" value={row.exam100} onChange={(e) => setRow(i, "exam100", e.target.value)} min="0" max="100"
                          className="w-full px-2 py-1 text-sm border border-gray-200 rounded text-center focus:outline-none bg-transparent" />
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-center text-xs text-gray-600">{ex70}</td>
                      <td className="border border-gray-300 px-2 py-1 text-center text-sm font-bold">{total}</td>
                      <td className="border border-gray-300 px-2 py-1 text-center text-xs font-semibold text-[#003087]">{posDisplay}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="student-name-dl">
              {studentNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>

          <div className="flex justify-center">
            <button onClick={() => setRows([...rows, emptyRow(rows.length + 1)])} className="text-sm text-[#003087] font-medium hover:underline">
              + Add Row
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={handlePrint} className="bg-gray-700 hover:bg-gray-800 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition">
            Preview & Print
          </button>
          <button onClick={() => handleSave("draft")} className="bg-[#003087] hover:bg-[#002570] text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition">
            Save Draft
          </button>
          <button onClick={() => handleSave("submitted")} className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition">
            Submit to Admin
          </button>
          <button onClick={onClose} className="bg-gray-100 text-gray-700 text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-gray-200 transition ml-auto">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreSheetPreviewModal({ sheet, onClose }: { sheet: ScoreSheet; onClose: () => void }) {
  const rows = sheet.rows.map((r) => {
    const cs = parseFloat(r.classScore) || 0;
    const ex100 = parseFloat(r.exam100) || 0;
    const ex70 = calcExam70(ex100);
    const total = calcTotal(cs, ex70);
    return { ...r, cs, ex100, ex70, total };
  });
  const sorted = rows.filter((r) => r.studentName).slice().sort((a, b) => b.total - a.total);
  const posMap = new Map<number, number>();
  sorted.forEach((r, i) => posMap.set(r.no, i + 1));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-900">{sheet.title}</h2>
          <div className="flex gap-2">
            <button onClick={onClose} className="bg-gray-100 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-200 transition">
              Close
            </button>
          </div>
        </div>
        <div className="p-6 overflow-x-auto">
          <div className="text-xs text-gray-500 mb-3 flex gap-4">
            <span>Subject: <strong>{sheet.subject}</strong></span>
            <span>Class: <strong>{sheet.class}</strong></span>
            <span>Term: <strong>{sheet.term}</strong></span>
            <span>Status: <StatusBadge status={sheet.status} /></span>
          </div>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-blue-50">
                <th className="border border-gray-300 px-3 py-2 text-left">#</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Student Name</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Class Score (30)</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Exam (100)</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Exam (70)</th>
                <th className="border border-gray-300 px-3 py-2 text-center font-bold">Total</th>
                <th className="border border-gray-300 px-3 py-2 text-center">Position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no} className={r.no % 2 === 0 ? "bg-gray-50" : "bg-white"}>
                  <td className="border border-gray-300 px-3 py-2">{r.no}</td>
                  <td className="border border-gray-300 px-3 py-2">{r.studentName}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center">{r.cs}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center">{r.ex100}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center">{r.ex70}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center font-bold">{r.total}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center font-semibold text-[#003087]">
                    {r.studentName ? ordinal(posMap.get(r.no) || 0) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
