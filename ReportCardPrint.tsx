import { Report, getReportTemplate, getSchoolLogo, ordinal, calcGrade } from "@/lib/storage";

interface Props {
  report: Report;
  onClose: () => void;
  onSubmit?: (r: Report) => void;
  isAdmin?: boolean;
}

export default function ReportCardPrint({ report, onClose, onSubmit, isAdmin }: Props) {
  const tmpl = getReportTemplate();
  const logo = getSchoolLogo();

  function handlePrint() {
    const html = buildPrintHtml(report, tmpl, logo);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 500);
  }

  const totalScore = report.subjects.reduce((sum, s) => sum + (s.total || 0), 0);
  const avg = report.subjects.length > 0 ? (totalScore / report.subjects.length).toFixed(1) : "0.0";

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center overflow-y-auto py-6 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl">
        {/* Header actions */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-900">Report Card — {report.studentName}</h2>
          <div className="flex gap-2">
            {isAdmin && !report.submittedByAdmin && onSubmit && (
              <button
                onClick={() => { onSubmit(report); onClose(); }}
                className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                Submit to Staff
              </button>
            )}
            <button onClick={handlePrint} className="bg-[#003087] hover:bg-[#002570] text-white text-sm font-medium px-4 py-2 rounded-lg transition">
              Print
            </button>
            <button onClick={onClose} className="bg-gray-100 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-200 transition">
              Close
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="p-6 font-[Arial,sans-serif] text-[11px]">
          {/* School Header */}
          <div className="border-b-2 border-[#003087] pb-3 mb-3 text-center">
            <div className="flex items-start justify-between mb-1">
              <div className="text-left text-[10px] leading-relaxed">
                <div>Tel: {tmpl.phone}</div>
                <div>P.O.Box: {tmpl.address}</div>
              </div>
              <div className="flex-1 px-4 flex justify-center">
                {logo ? (
                  <img src={logo} alt="Logo" className="h-16 object-contain" />
                ) : (
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-400">LOGO</div>
                )}
              </div>
              <div className="text-right text-[10px] leading-relaxed">
                <div>Email: {tmpl.email}</div>
                <div>Motto: {tmpl.motto}</div>
              </div>
            </div>
            <div className="text-base font-black text-[#003087]">{tmpl.schoolName}</div>
            <div className="text-sm font-bold text-[#003087]">{tmpl.schoolSub}</div>
            <div className="text-[10px] text-gray-500">{tmpl.address}</div>
          </div>

          <div className="text-center font-bold uppercase text-xs mb-3 tracking-wide">Student's Academic Report</div>
          <hr className="border-gray-300 mb-3" />

          {/* Student Info Row */}
          <div className="flex justify-between mb-3 text-[10px] gap-4">
            <div className="space-y-1.5">
              <InfoField label="Name of Student" value={report.studentName} wide />
              <InfoField label="Class" value={report.studentClass} />
              <InfoField label="Academic Year" value={report.academicYear} />
            </div>
            <div className="space-y-1.5">
              <InfoField label="Term" value={report.term} />
              <InfoField label="Total Students" value={report.totalStudents} />
              <InfoField label="Attendance" value={report.attendance} />
            </div>
          </div>

          {/* Grading Key */}
          <div className="bg-gray-100 border border-gray-300 px-3 py-2 text-[9px] mb-3 font-bold">
            GRADING: A1 (80-100) Excellent · B2 (70-79) Very Good · B3 (65-69) Good · C4 (60-64) Credit · C5 (55-59) Credit · C6 (50-54) Credit · D7 (45-49) Pass · E8 (40-44) Pass · F9 (0-39) Fail
          </div>

          {/* Subject Table */}
          <table className="w-full border-collapse text-[10px] mb-3">
            <thead>
              <tr className="bg-[#e0e8f0]">
                <th className="border border-gray-500 px-2 py-1.5 text-left">Subject</th>
                <th className="border border-gray-500 px-2 py-1.5 text-center">Class Score (30%)</th>
                <th className="border border-gray-500 px-2 py-1.5 text-center">Exam Score (100%)</th>
                <th className="border border-gray-500 px-2 py-1.5 text-center">Exam Score (70%)</th>
                <th className="border border-gray-500 px-2 py-1.5 text-center font-bold">Total (100%)</th>
                <th className="border border-gray-500 px-2 py-1.5 text-center">Position</th>
                <th className="border border-gray-500 px-2 py-1.5 text-center">Remark</th>
              </tr>
            </thead>
            <tbody>
              {report.subjects.map((s, i) => {
                const grade = calcGrade(s.total);
                const pos = s.position ? ordinal(parseInt(s.position) || 0) : (s.position || "");
                return (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    <td className="border border-gray-500 px-2 py-1.5">{s.subject}</td>
                    <td className="border border-gray-500 px-2 py-1.5 text-center">{s.classScore}</td>
                    <td className="border border-gray-500 px-2 py-1.5 text-center">{s.exam100}</td>
                    <td className="border border-gray-500 px-2 py-1.5 text-center">{s.exam70}</td>
                    <td className="border border-gray-500 px-2 py-1.5 text-center font-bold">{s.total}</td>
                    <td className="border border-gray-500 px-2 py-1.5 text-center">{pos}</td>
                    <td className="border border-gray-500 px-2 py-1.5 text-center">{grade}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Summary Row */}
          <div className="flex gap-8 text-[10px] mb-3">
            <InfoField label="Aggregate" value={totalScore.toString()} />
            <InfoField label="Average" value={avg} />
            <InfoField label="House / Stream" value={report.houseOrStream} />
            <InfoField label="Next Term Begins" value={report.nextTermBegins} />
          </div>

          {/* Remarks */}
          <div className="space-y-2 mb-4 text-[10px]">
            <div className="flex gap-2 items-baseline">
              <span className="font-bold whitespace-nowrap">Class Teacher's Remarks:</span>
              <span className="border-b border-black flex-1 min-w-0">{report.classTeacherRemarks}</span>
            </div>
            <div className="flex gap-2 items-baseline">
              <span className="font-bold whitespace-nowrap">Head Teacher's Remarks:</span>
              <span className="border-b border-black flex-1 min-w-0">{report.headTeacherRemarks}</span>
            </div>
          </div>

          {/* Signatures */}
          <div className="flex gap-16 text-[10px] mt-4">
            <div className="flex gap-2 items-baseline">
              <span className="font-bold whitespace-nowrap">Class Teacher's Signature:</span>
              <span className="border-b border-black min-w-28">{report.classTeacherSignature}</span>
            </div>
            <div className="flex gap-2 items-baseline">
              <span className="font-bold whitespace-nowrap">Head Teacher's Signature:</span>
              <span className="border-b border-black min-w-28">{report.headTeacherSignature}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`flex items-baseline gap-1 ${wide ? "min-w-64" : "min-w-44"}`}>
      <span className="font-bold whitespace-nowrap">{label}:</span>
      <span className="border-b border-black flex-1 min-w-16">{value}</span>
    </div>
  );
}

function buildPrintHtml(report: Report, tmpl: ReturnType<typeof getReportTemplate>, logo: string) {
  const totalScore = report.subjects.reduce((sum, s) => sum + (s.total || 0), 0);
  const avg = report.subjects.length > 0 ? (totalScore / report.subjects.length).toFixed(1) : "0.0";

  const subjectRows = report.subjects.map((s) => {
    const grade = calcGrade(s.total);
    const pos = s.position ? ordinal(parseInt(s.position) || 0) : (s.position || "");
    const remarkMap: Record<string, string> = {
      A1: "Excellent", B2: "Very Good", B3: "Good", C4: "Credit", C5: "Credit", C6: "Credit", D7: "Pass", E8: "Pass", F9: "Fail"
    };
    return `<tr><td>${s.subject}</td><td>${s.classScore}</td><td>${s.exam100}</td><td>${s.exam70}</td>
      <td style="font-weight:bold">${s.total}</td><td>${pos}</td><td>${remarkMap[grade] || ""}</td></tr>`;
  }).join("");

  const logoHtml = logo ? `<img src="${logo}" style="max-height:70px;max-width:120px;object-fit:contain;" />` : `<div style="width:70px;height:70px;background:#f0f0f0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;color:#999;">LOGO</div>`;

  return `<!DOCTYPE html>
<html><head><title>Report Card - ${report.studentName}</title>
<style>
  @page { size: A4; margin: 10mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #000; background: white; }
  .report-wrapper { width: 100%; max-width: 190mm; margin: 0 auto; }
  .header { text-align: center; border-bottom: 2px solid #003087; padding-bottom: 8px; margin-bottom: 8px; }
  .school-name { font-size: 16px; font-weight: bold; color: #003087; letter-spacing: 0.5px; }
  .school-sub { font-size: 12px; font-weight: bold; color: #003087; }
  .school-location { font-size: 10px; color: #555; }
  .top-info { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .top-left { font-size: 9.5px; line-height: 1.7; }
  .top-right { font-size: 9.5px; line-height: 1.7; text-align: right; }
  .logo-container { display: flex; justify-content: center; flex: 1; padding: 0 16px; }
  .divider { border: none; border-top: 1px solid #aaa; margin: 8px 0; }
  .student-info-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .student-col { font-size: 10px; line-height: 2.2; }
  .field { display: flex; }
  .field-label { font-weight: bold; white-space: nowrap; margin-right: 4px; }
  .field-value { border-bottom: 1px solid #000; flex: 1; min-width: 140px; }
  .key-box { background: #f0f0f0; border: 1px solid #aaa; padding: 4px 8px; font-size: 9.5px; margin: 8px 0; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }
  th, td { border: 1px solid #555; padding: 4px 5px; text-align: center; }
  th { background: #e0e8f0; font-weight: bold; }
  td:first-child { text-align: left; }
  .bottom-section { font-size: 9.5px; line-height: 2.2; margin-top: 8px; }
  .bottom-row { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 4px; align-items: baseline; }
  .bottom-field { display: inline-flex; align-items: baseline; gap: 4px; }
  .bottom-field-label { font-weight: bold; white-space: nowrap; }
  .bottom-field-line { border-bottom: 1px solid #000; display: inline-block; min-width: 80px; }
  .full-line { display: flex; align-items: baseline; gap: 4px; margin-bottom: 4px; }
  .full-line-value { border-bottom: 1px solid #000; flex: 1; min-width: 0; }
  .signature-row { margin-top: 14px; display: flex; align-items: baseline; gap: 4px; }
  .signature-value { border-bottom: 1px solid #000; flex: 1; }
</style></head><body>
<div class="report-wrapper">
  <div class="header">
    <div class="top-info">
      <div class="top-left">Tel: ${tmpl.phone}<br/>P.O.Box: ${tmpl.address}</div>
      <div class="logo-container">${logoHtml}</div>
      <div class="top-right">Email: ${tmpl.email}<br/>Motto: ${tmpl.motto}</div>
    </div>
    <div class="school-name">${tmpl.schoolName}</div>
    <div class="school-sub">${tmpl.schoolSub}</div>
    <div class="school-location">${tmpl.address}</div>
  </div>

  <div style="text-align:center;font-weight:bold;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Student's Academic Report</div>
  <hr class="divider"/>

  <div class="student-info-row">
    <div class="student-col">
      <div class="field"><span class="field-label">Name of Student:</span><span class="field-value">${report.studentName}</span></div>
      <div class="field"><span class="field-label">Class:</span><span class="field-value">${report.studentClass}</span></div>
      <div class="field"><span class="field-label">Academic Year:</span><span class="field-value">${report.academicYear}</span></div>
    </div>
    <div class="student-col">
      <div class="field"><span class="field-label">Term:</span><span class="field-value">${report.term}</span></div>
      <div class="field"><span class="field-label">Total Students in Class:</span><span class="field-value">${report.totalStudents}</span></div>
      <div class="field"><span class="field-label">Attendance:</span><span class="field-value">${report.attendance}</span></div>
    </div>
  </div>

  <div class="key-box">GRADING SYSTEM: A1 (80-100) Excellent &nbsp;|&nbsp; B2 (70-79) Very Good &nbsp;|&nbsp; B3 (65-69) Good &nbsp;|&nbsp; C4 (60-64) Credit &nbsp;|&nbsp; C5 (55-59) Credit &nbsp;|&nbsp; C6 (50-54) Credit &nbsp;|&nbsp; D7 (45-49) Pass &nbsp;|&nbsp; E8 (40-44) Pass &nbsp;|&nbsp; F9 (0-39) Fail</div>

  <table>
    <thead>
      <tr>
        <th style="text-align:left">Subject</th>
        <th>Class Score (30%)</th>
        <th>Exam Score (100%)</th>
        <th>Exam Score (70%)</th>
        <th>Total (100%)</th>
        <th>Position</th>
        <th>Remark</th>
      </tr>
    </thead>
    <tbody>${subjectRows}</tbody>
  </table>

  <div class="bottom-section">
    <div class="bottom-row">
      <div class="bottom-field"><span class="bottom-field-label">Aggregate:</span><span class="bottom-field-line">${totalScore}</span></div>
      <div class="bottom-field"><span class="bottom-field-label">Average:</span><span class="bottom-field-line">${avg}</span></div>
      <div class="bottom-field"><span class="bottom-field-label">House/Stream:</span><span class="bottom-field-line">${report.houseOrStream}</span></div>
      <div class="bottom-field"><span class="bottom-field-label">Next Term Begins:</span><span class="bottom-field-line">${report.nextTermBegins}</span></div>
    </div>
    <div class="full-line"><span class="field-label">Class Teacher's Remarks:</span><span class="full-line-value">${report.classTeacherRemarks}</span></div>
    <div class="full-line"><span class="field-label">Head Teacher's Remarks:</span><span class="full-line-value">${report.headTeacherRemarks}</span></div>
    <div style="margin-top:14px;display:flex;gap:40px;">
      <div class="signature-row"><span class="field-label">Class Teacher's Signature:</span><span class="signature-value">${report.classTeacherSignature}</span></div>
      <div class="signature-row"><span class="field-label">Head Teacher's Signature:</span><span class="signature-value">${report.headTeacherSignature}</span></div>
    </div>
  </div>
</div>
</body></html>`;
}
