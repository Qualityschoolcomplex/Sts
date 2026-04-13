import { useEffect, useState } from "react";
import { syncFromServer, getCurrentUser, User } from "@/lib/storage";
import LoginPage from "@/pages/LoginPage";
import AdminDashboard from "@/pages/AdminDashboard";
import StaffDashboard from "@/pages/StaffDashboard";
import DownloadsPage from "@/pages/DownloadsPage";

type View = "loading" | "login" | "admin" | "staff";

const isDownloadsPath = window.location.pathname === "/downloads";

export default function App() {
  const [view, setView] = useState<View>(isDownloadsPath ? "login" : "loading");

  useEffect(() => {
    if (isDownloadsPath) return;
    syncFromServer().then(() => {
      const user = getCurrentUser();
      if (user) setView(user.role === "admin" ? "admin" : "staff");
      else setView("login");
    });
  }, []);

  function handleLogin(user: User) {
    setView(user.role === "admin" ? "admin" : "staff");
  }

  function handleLogout() {
    setView("login");
  }

  if (isDownloadsPath) return <DownloadsPage />;

  if (view === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#003087]">
        <div className="text-center text-white">
          <div className="w-14 h-14 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-5" />
          <div className="text-xl font-bold tracking-wide">QUALITY SCHOOL COMPLEX</div>
          <div className="text-sm mt-2 text-white/70">Student Information System</div>
        </div>
      </div>
    );
  }

  if (view === "login") return <LoginPage onLogin={handleLogin} />;
  if (view === "admin") return <AdminDashboard onLogout={handleLogout} />;
  if (view === "staff") return <StaffDashboard onLogout={handleLogout} />;

  return null;
}
