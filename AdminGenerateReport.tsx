import { useState, useEffect } from "react";
import {
  getReports, saveReports, Report, getScoreSheets, ScoreSheet,
  getReportTemplate, getSchoolLogo, ordinal, calcExam70, calcTotal, calcGrade,
  SubjectResult,
} from "@/lib/storage";
import ReportCardPrint from "@/components/shared/ReportCardPrint";

export default function AdminGenerateReport() {
  const [reports, setReports] = useState<Report[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [viewReport, setViewReport] = useState<Report | null>(null);

  useEffect(() => { refresh(); }, []);
  function refresh() { setReports(getReports()); }

  function handleSubmitReport(report: Report) {
    const all = getReports();
    const idx = all.findIndex((r) => r.id === report.id);
    const updated = { ...report, submittedByAdmin: true, submittedAt: new Date().toISOString() };
    if (idx >= 0) { all[idx] = updated; } else { all.push(updated); }
    saveReports(all);
    refresh();
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this report?")) return;
    saveReports(getReports().filter((r) => r.id !== id));
    refresh();
  }

  const submitted = reports.filter((r) => r.submittedByAdmin);
  const drafts = reports.filter((r) => !r.submittedByAdmin);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Generate Reports</h2>
          <p className="text-sm text-gray-500 mt-0.5">Create and manage student report cards</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-[#003087] hover:bg-[#002570] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Create Report
        </button>
      </div>

      {/* Submitted Reports */}
      {submitted.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">Submitted Reports ({submitted.length})</h3>
          <div className="space-y-3">
            {submitted.map((r) => (
              <ReportCard key={r.id} report={r} onView={() => setViewReport(r)} onDelete={() => handleDelete(r.id)} onSubmit={handleSubmitReport} />
            ))}
          </div>
        </div>
      )}

      {/* Draft Reports */}
      {drafts.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-700 mb-3 text-sm uppercase tracking-wide">Draft Reports ({drafts.length})</h3>
          <div className="space-y-3">
            {drafts.map((r) => (
              <ReportCard key={r.id} report={r} onView={() => setViewReport(r)} onDelete={() => handleDelete(r.id)} onSubmit={handleSubmitReport} />
            ))}
          </div>
        </div>
      )}

      {reports.length === 0 && (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <div className="text-5xl mb-3">📄</div>
          <p className="font-semibold text-gray-500">No reports yet</p>
          <p className="text-sm text-gray-400 mt-1">Create a report card to get started</p>
        </div>
      )}

      {showCreate && (
        <CreateReportModal
          onClose={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {viewReport && (
        <ReportCardPrint report={viewReport} onClose={() => setViewReport(null)} onSubmit={handleSubmitReport} isAdmin />
      )}
    </div>
  );
}

function ReportCard({ report, onView, onDelete, onSubmit }: {
  report: Report; onView: () => void; onDelete: () => void; onSubmit: (r: Report) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">{report.studentName}</span>
          {report.submittedByAdmin && <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">Submitted</span>}
        </div>
        <div className="text-xs text-gray-500 mt-1 flex gap-x-4 flex-wrap gap-y-1">
          <span>Class: <strong className="text-gray-700">{report.studentClass}</strong></span>
          <span>Term: <strong className="text-gray-700">{report.term}</strong></span>
          <span>Year: <strong className="text-gray-700">{report.academicYear}</strong></span>
          <span>Subjects: <strong className="text-gray-700">{report.subjects.length}</strong></span>
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button onClick={onView} className="bg-gray-100 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-200 transition">
          View / Print
        </button>
        {!report.submittedByAdmin && (
          <button
            onClick={() => onSubmit(report)}
            className="bg-green-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-green-700 transition"
          >
            Submit
          </button>
        )}
        <button onClick={onDelete} className="bg-red-50 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-red-100 transition">
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateReportModal({ onClose }: { onClose: () => void }) {
  const approvedSheets = getScoreSheets().filter((s) => s.status === "approved");
  const template = getReportTemplate();

  // Get unique student names from approved sheets
  const studentsFromSheets: string[] = [];
  approvedSheets.forEach((sh) => {
    sh.rows.forEach((r) => {
      if (r.studentName && !studentsFromSheets.includes(r.studentName)) {
        studentsFromSheets.push(r.studentName);
      }
    });
  });

  const SUBJECTS = ["English Language", "Mathematics", "Science", "Social Studies", "Religious & Moral Education", "Creative Arts", "French", "ICT", "Physical Education"];
  const TERMS = ["Term 1", "Term 2", "Term 3"];

  const emptySubject = () => ({
    subject: "",
    classScore: 0, exam100: 0, exam70: 0, total: 0, position: "",
  });

  const [form, setForm] = useState({
    studentName: "",
    studentClass: "",
    term: "Term 1",
    academicYear: "2024/2025",
    totalStudents: "",
    attendance: "",
    nextTermBegins: "",
    houseOrStream: "",
    classTeacherRemarks: "",
    headTeacherRemarks: "",
    classTeacherSignature: "",
    headTeacherSignature: "",
  });
  const [subjects, setSubjects] = useState<SubjectResult[]>([emptySubject()]);

  function autoFillFromSheets(name: string) {
    if (!name) return;
    const matched: SubjectResult[] = [];
    approvedSheets.forEach((sh) => {
      sh.rows.forEach((r) => {
        if ((r.studentName || "").toLowerCase() === name.toLowerCase()) {
          const cs = parseFloat(r.classScore) || 0;
          const ex100 = parseFloat(r.exam100) || 0;
          const ex70 = calcExam70(ex100);
          const total = calcTotal(cs, ex70);
          matched.push({ subject: sh.subject, classScore: cs, exam100: ex100, exam70: ex70, total, position: "" });
        }
      });
    });
    if (matched.length > 0) {
      // Compute positions within same class/sheet
      setSubjects(matched.length > 0 ? matched : [emptySubject()]);
    }
  }

  function setSubjectField(i: number, key: keyof SubjectResult, val: string | number) {
    const updated = [...subjects];
    (updated[i] as any)[key] = val;
    // Auto-calc derived fields
    if (key === "classScore" || key === "exam100") {
      const cs = key === "classScore" ? Number(val) : updated[i].classScore;
      const ex100 = key === "exam100" ? Number(val) : updated[i].exam100;
      updated[i].exam70 = calcExam70(ex100);
      updated[i].total = calcTotal(cs, updated[i].exam70);
    }
    setSubjects(updated);
  }

  function handleSave(submitToStaff: boolean) {
    const report: Report = {
      id: "r_" + Date.now(),
      ...form,
      subjects,
      createdAt: new Date().toISOString(),
      submittedByAdmin: submitToStaff,
      submittedAt: submitToStaff ? new Date().toISOString() : null,
    };
    const all = getReports();
    all.push(report);
    saveReports(all);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Create Report Card</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl font-bold">✕</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Student Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Student Name</label>
              <input
                list="student-names-list"
                type="text"
                value={form.studentName}
                onChange={(e) => { setForm({ ...form, studentName: e.target.value }); }}
                onBlur={(e) => autoFillFromSheets(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]"
                placeholder="Student full name"
              />
              <datalist id="student-names-list">
                {studentsFromSheets.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
            <F label="Class" value={form.studentClass} onChange={(v) => setForm({ ...form, studentClass: v })} />
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Term</label>
              <select value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none">
                {TERMS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <F label="Academic Year" value={form.academicYear} onChange={(v) => setForm({ ...form, academicYear: v })} />
            <F label="Total Students in Class" value={form.totalStudents} onChange={(v) => setForm({ ...form, totalStudents: v })} />
            <F label="Attendance" value={form.attendance} onChange={(v) => setForm({ ...form, attendance: v })} />
            <F label="Next Term Begins" value={form.nextTermBegins} onChange={(v) => setForm({ ...form, nextTermBegins: v })} />
            <F label="House / Stream" value={form.houseOrStream} onChange={(v) => setForm({ ...form, houseOrStream: v })} />
          </div>

          {/* Subject Results */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800">Subject Results</h3>
              <button
                onClick={() => setSubjects([...subjects, emptySubject()])}
                className="text-sm text-[#003087] font-medium hover:underline"
              >
                + Add Subject
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-blue-50">
                    <th className="border border-gray-300 px-3 py-2 text-left">Subject</th>
                    <th className="border border-gray-300 px-3 py-2 text-center">Class Score</th>
                    <th className="border border-gray-300 px-3 py-2 text-center">Exam (100)</th>
                    <th className="border border-gray-300 px-3 py-2 text-center">Exam (70)</th>
                    <th className="border border-gray-300 px-3 py-2 text-center">Total</th>
                    <th className="border border-gray-300 px-3 py-2 text-center">Position</th>
                    <th className="border border-gray-300 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((s, i) => (
                    <tr key={i}>
                      <td className="border border-gray-300 px-2 py-1">
                        <input
                          list={`subj-list-${i}`}
                          value={s.subject}
                          onChange={(e) => setSubjectField(i, "subject", e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none"
                          placeholder="Subject name"
                        />
                        <datalist id={`subj-list-${i}`}>{SUBJECTS.map((sub) => <option key={sub} value={sub} />)}</datalist>
                      </td>
                      <td className="border border-gray-300 px-2 py-1">
                        <input type="number" value={s.classScore || ""} onChange={(e) => setSubjectField(i, "classScore", e.target.value)} min="0" max="30"
                          className="w-full px-2 py-1 text-sm border border-gray-200 rounded text-center focus:outline-none" />
                      </td>
                      <td className="border border-gray-300 px-2 py-1">
                        <input type="number" value={s.exam100 || ""} onChange={(e) => setSubjectField(i, "exam100", e.target.value)} min="0" max="100"
                          className="w-full px-2 py-1 text-sm border border-gray-200 rounded text-center focus:outline-none" />
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-center text-gray-600">{s.exam70 || ""}</td>
                      <td className="border border-gray-300 px-2 py-1 text-center font-bold">{s.total || ""}</td>
                      <td className="border border-gray-300 px-2 py-1">
                        <input value={s.position} onChange={(e) => setSubjectField(i, "position", e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-gray-200 rounded text-center focus:outline-none" placeholder="e.g. 3" />
                      </td>
                      <td className="border border-gray-300 px-2 py-1 text-center">
                        {subjects.length > 1 && (
                          <button onClick={() => setSubjects(subjects.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 text-xs">✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Remarks & Signatures */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Class Teacher's Remarks</label>
              <textarea value={form.classTeacherRemarks} onChange={(e) => setForm({ ...form, classTeacherRemarks: e.target.value })}
                rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Head Teacher's Remarks</label>
              <textarea value={form.headTeacherRemarks} onChange={(e) => setForm({ ...form, headTeacherRemarks: e.target.value })}
                rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none" />
            </div>
            <F label="Class Teacher's Signature" value={form.classTeacherSignature} onChange={(v) => setForm({ ...form, classTeacherSignature: v })} />
            <F label="Head Teacher's Signature" value={form.headTeacherSignature} onChange={(v) => setForm({ ...form, headTeacherSignature: v })} />
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button onClick={() => handleSave(true)} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-lg text-sm transition">
            Save & Submit to Staff
          </button>
          <button onClick={() => handleSave(false)} className="flex-1 bg-[#003087] hover:bg-[#002570] text-white font-semibold py-2.5 rounded-lg text-sm transition">
            Save as Draft
          </button>
          <button onClick={onClose} className="bg-gray-100 text-gray-700 font-semibold px-5 py-2.5 rounded-lg text-sm hover:bg-gray-200 transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function F({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]" />
    </div>
  );
}
