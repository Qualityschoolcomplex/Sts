import { useState, useEffect } from "react";
import {
  getCurrentUser, setCurrentUser, getUsers, saveUsers, User,
  getScoreSheets, saveScoreSheets,
  getReports, getReportTemplate, saveReportTemplate, getSchoolLogo, saveSchoolLogo, removeSchoolLogo,
  DEFAULT_TEMPLATE,
} from "@/lib/storage";
import ManageUsers from "@/components/admin/ManageUsers";
import ReportTemplatePanel from "@/components/admin/ReportTemplatePanel";
import AdminScoreSheets from "@/components/admin/AdminScoreSheets";
import AdminGenerateReport from "@/components/admin/AdminGenerateReport";

type Tab = "users" | "template" | "score-sheets" | "reports";

interface Props {
  onLogout: () => void;
}

export default function AdminDashboard({ onLogout }: Props) {
  const user = getCurrentUser()!;
  const [tab, setTab] = useState<Tab>("users");

  function handleLogout() {
    setCurrentUser(null);
    onLogout();
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "users", label: "Manage Users" },
    { id: "score-sheets", label: "Score Sheets" },
    { id: "reports", label: "Generate Reports" },
    { id: "template", label: "Report Settings" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Nav */}
      <header className="bg-[#003087] text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/10 border border-white/20 rounded-full flex items-center justify-center font-black text-sm">QSC</div>
            <div>
              <div className="font-bold text-sm leading-tight">Quality School Complex</div>
              <div className="text-xs text-white/60">Admin Dashboard</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-white/80 hidden sm:block">
              {user.displayName || user.username}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1.5 rounded-lg transition"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex gap-0 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-5 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
                  tab === t.id
                    ? "border-white text-white"
                    : "border-transparent text-white/60 hover:text-white/80"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {tab === "users" && <ManageUsers currentUser={user} />}
        {tab === "score-sheets" && <AdminScoreSheets />}
        {tab === "reports" && <AdminGenerateReport />}
        {tab === "template" && <ReportTemplatePanel />}
      </main>
    </div>
  );
}
