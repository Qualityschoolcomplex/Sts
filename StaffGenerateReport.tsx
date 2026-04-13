import { useState, useEffect } from "react";
import {
  getReports, Report, getScoreSheets, getCurrentUser,
  calcExam70, calcTotal, SubjectResult, ordinal,
} from "@/lib/storage";
import ReportCardPrint from "@/components/shared/ReportCardPrint";

export default function StaffGenerateReport() {
  const user = getCurrentUser()!;
  const [reports, setReports] = useState<Report[]>([]);
  const [viewReport, setViewReport] = useState<Report | null>(null);

  // Check if this staff has any approved score sheets
  const approvedSheets = getScoreSheets().filter(
    (s) => s.staffUsername === user.username && s.status === "approved"
  );
  const hasApproved = approvedSheets.length > 0;

  // Submitted reports from admin
  const submittedReports = getReports().filter((r) => r.submittedByAdmin);

  useEffect(() => {
    setReports(getReports().filter((r) => r.submittedByAdmin));
  }, []);

  if (!hasApproved) {
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Generate Reports</h2>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mt-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h3 className="font-semibold text-yellow-800 mb-1">Access Restricted</h3>
              <p className="text-sm text-yellow-700">
                Your score sheets must be submitted and approved by admin before you can access reports.
                Please submit your score sheets from the <strong>Score Sheets</strong> section and wait for admin approval.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Get student names from approved sheets for this staff
  const studentsFromSheets: string[] = [];
  approvedSheets.forEach((sh) => {
    sh.rows.forEach((r) => {
      if (r.studentName && !studentsFromSheets.includes(r.studentName)) {
        studentsFromSheets.push(r.studentName);
      }
    });
  });

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900">Generate Reports</h2>
        <p className="text-sm text-gray-500 mt-0.5">Reports submitted by admin — import student results to view and print</p>
      </div>

      {submittedReports.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <div className="text-5xl mb-3">📄</div>
          <p className="font-semibold text-gray-500">No reports available yet</p>
          <p className="text-sm text-gray-400 mt-1">Waiting for admin to submit report templates</p>
        </div>
      ) : (
        <div className="space-y-3">
          {submittedReports.map((report) => (
            <div key={report.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm">{report.studentName}</span>
                    <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">From Admin</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-4">
                    <span>Class: <strong className="text-gray-700">{report.studentClass}</strong></span>
                    <span>Term: <strong className="text-gray-700">{report.term}</strong></span>
                    <span>Year: <strong className="text-gray-700">{report.academicYear}</strong></span>
                  </div>
                </div>
                <button
                  onClick={() => setViewReport(report)}
                  className="bg-[#003087] text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-[#002570] transition"
                >
                  View / Print
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import from Score Sheets section */}
      <div className="mt-8">
        <h3 className="font-semibold text-gray-700 mb-3">Import from Your Score Sheets</h3>
        <p className="text-sm text-gray-500 mb-4">Students from your approved score sheets — their results can be viewed below.</p>

        {studentsFromSheets.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-500 text-center">
            No student results found in your approved score sheets.
          </div>
        ) : (
          <div className="space-y-2">
            {studentsFromSheets.map((name) => {
              const subjectResults: SubjectResult[] = [];
              approvedSheets.forEach((sh) => {
                sh.rows.forEach((r) => {
                  if ((r.studentName || "").toLowerCase() === name.toLowerCase()) {
                    const cs = parseFloat(r.classScore) || 0;
                    const ex100 = parseFloat(r.exam100) || 0;
                    const ex70 = calcExam70(ex100);
                    const total = calcTotal(cs, ex70);
                    subjectResults.push({
                      subject: sh.subject,
                      classScore: cs,
                      exam100: ex100,
                      exam70: ex70,
                      total,
                      position: "",
                    });
                  }
                });
              });

              return (
                <div key={name} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-gray-900 text-sm">{name}</span>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {subjectResults.length} subject{subjectResults.length !== 1 ? "s" : ""} recorded
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const preview: Report = {
                          id: "preview_" + Date.now(),
                          studentName: name,
                          studentClass: approvedSheets[0]?.class || "",
                          term: approvedSheets[0]?.term || "",
                          academicYear: approvedSheets[0]?.academicYear || "",
                          totalStudents: "",
                          attendance: "",
                          nextTermBegins: "",
                          houseOrStream: "",
                          subjects: subjectResults,
                          classTeacherRemarks: "",
                          headTeacherRemarks: "",
                          classTeacherSignature: "",
                          headTeacherSignature: "",
                          createdAt: new Date().toISOString(),
                          submittedByAdmin: false,
                          submittedAt: null,
                        };
                        setViewReport(preview);
                      }}
                      className="bg-gray-100 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-200 transition"
                    >
                      View Results
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {viewReport && (
        <ReportCardPrint
          report={viewReport}
          onClose={() => setViewReport(null)}
          isAdmin={false}
        />
      )}
    </div>
  );
}
