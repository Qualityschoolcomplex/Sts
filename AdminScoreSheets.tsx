import { useState, useEffect } from "react";
import { getScoreSheets, saveScoreSheets, ScoreSheet, ordinal, calcExam70, calcTotal } from "@/lib/storage";

export default function AdminScoreSheets() {
  const [sheets, setSheets] = useState<ScoreSheet[]>([]);
  const [preview, setPreview] = useState<ScoreSheet | null>(null);

  useEffect(() => { refresh(); }, []);

  function refresh() {
    setSheets(getScoreSheets().filter((s) => s.status === "submitted" || s.status === "approved"));
  }

  function handleApprove(id: string) {
    const all = getScoreSheets();
    const idx = all.findIndex((s) => s.id === id);
    if (idx < 0) return;
    all[idx].status = "approved";
    all[idx].approvedAt = new Date().toISOString();
    saveScoreSheets(all);
    refresh();
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this score sheet? This cannot be undone.")) return;
    saveScoreSheets(getScoreSheets().filter((s) => s.id !== id));
    refresh();
  }

  function handlePrint(sheet: ScoreSheet) {
    printSheet(sheet);
  }

  if (sheets.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Submitted Score Sheets</h2>
        <p className="text-sm text-gray-500 mb-6">Review and approve score sheets submitted by staff</p>
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <div className="text-5xl mb-3">📋</div>
          <p className="font-semibold text-gray-500">No submitted score sheets yet</p>
          <p className="text-sm text-gray-400 mt-1">Staff must submit their score sheets first</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Submitted Score Sheets</h2>
          <p className="text-sm text-gray-500 mt-0.5">{sheets.length} sheet(s) awaiting review</p>
        </div>
      </div>

      <div className="space-y-3">
        {sheets.map((sheet) => {
          const date = new Date(sheet.submittedAt || sheet.createdAt);
          const approved = sheet.status === "approved";
          return (
            <div key={sheet.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 text-sm">{sheet.title || "Untitled"}</h3>
                    {approved && (
                      <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">Approved</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Subject: <strong className="text-gray-700">{sheet.subject || "—"}</strong></span>
                    <span>Class: <strong className="text-gray-700">{sheet.class || "—"}</strong></span>
                    <span>Term: <strong className="text-gray-700">{sheet.term || "—"}</strong></span>
                    <span>Staff: <strong className="text-gray-700">{sheet.staffName || sheet.staffUsername}</strong></span>
                    <span>Date: <strong className="text-gray-700">{date.toLocaleDateString()}</strong></span>
                    <span>Students: <strong className="text-gray-700">{sheet.rows.filter((r) => r.studentName).length}</strong></span>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setPreview(sheet)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg transition">
                    Preview
                  </button>
                  {!approved && (
                    <button onClick={() => handleApprove(sheet.id)} className="bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition">
                      Approve
                    </button>
                  )}
                  <button onClick={() => handlePrint(sheet)} className="bg-[#003087] hover:bg-[#002570] text-white text-xs font-medium px-3 py-1.5 rounded-lg transition">
                    Print
                  </button>
                  <button onClick={() => handleDelete(sheet.id)} className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-medium px-3 py-1.5 rounded-lg transition">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {preview && <ScoreSheetPreview sheet={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ScoreSheetPreview({ sheet, onClose }: { sheet: ScoreSheet; onClose: () => void }) {
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
            <button onClick={() => printSheet(sheet)} className="bg-[#003087] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#002570] transition">
              Print
            </button>
            <button onClick={onClose} className="bg-gray-100 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-200 transition">
              Close
            </button>
          </div>
        </div>
        <div className="p-6 overflow-x-auto">
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
                <tr key={r.no} className="even:bg-gray-50">
                  <td className="border border-gray-300 px-3 py-2">{r.no}</td>
                  <td className="border border-gray-300 px-3 py-2">{r.studentName}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center">{r.cs}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center">{r.ex100}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center">{r.ex70}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center font-bold">{r.total}</td>
                  <td className="border border-gray-300 px-3 py-2 text-center">{r.studentName ? ordinal(posMap.get(r.no) || 0) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function printSheet(sheet: ScoreSheet) {
  const rows = sheet.rows.map((r, i) => {
    const cs = parseFloat(r.classScore) || 0;
    const ex100 = parseFloat(r.exam100) || 0;
    const ex70 = calcExam70(ex100);
    const total = calcTotal(cs, ex70);
    return `<tr><td>${i + 1}</td><td style="text-align:left">${r.studentName || ""}</td>
      <td>${cs}</td><td>${ex100}</td><td>${ex70}</td>
      <td style="font-weight:bold">${total}</td></tr>`;
  }).join("");

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><title>${sheet.title}</title>
  <style>@page{size:A4 landscape;margin:10mm;}body{font-family:Arial,sans-serif;font-size:10px;}
  h2,h3{margin:0 0 4px;}table{width:100%;border-collapse:collapse;}
  th,td{border:1px solid #555;padding:3px 6px;text-align:center;}th{background:#dce8f5;}
  td:nth-child(2){text-align:left;}.meta{font-size:10px;margin-bottom:8px;}</style></head>
  <body>
  <h2>${sheet.title}</h2>
  <div class="meta">Subject: ${sheet.subject} &nbsp;|&nbsp; Class: ${sheet.class} &nbsp;|&nbsp; Term: ${sheet.term} &nbsp;|&nbsp; Year: ${sheet.academicYear} &nbsp;|&nbsp; Staff: ${sheet.staffName}</div>
  <table><thead><tr><th>#</th><th>Student Name</th><th>Class Score (30%)</th><th>Exam Score (100%)</th><th>Exam Score (70%)</th><th>Total</th></tr></thead>
  <tbody>${rows}</tbody></table>
  </body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 500);
}
