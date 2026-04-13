import { useState } from "react";
import { getUsers, setCurrentUser, saveUsers, User } from "@/lib/storage";

interface Props {
  onLogin: (user: User) => void;
}

const DEFAULT_ADMIN: User = {
  id: "default_admin",
  username: "admin",
  password: "admin123",
  displayName: "Administrator",
  role: "admin",
};

export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    setTimeout(() => {
      let users = getUsers();
      // Ensure default admin exists if no users
      if (users.length === 0) {
        users = [DEFAULT_ADMIN];
        saveUsers(users);
      }

      const user = users.find(
        (u) => u.username === username.trim() && u.password === password
      );

      if (user) {
        setCurrentUser(user);
        onLogin(user);
      } else {
        setError("Wrong username or password");
      }
      setLoading(false);
    }, 400);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#003087] to-[#1a56b5] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo & School Name */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white/10 backdrop-blur rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-white/30">
            <span className="text-3xl font-black text-white">QSC</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Quality School Complex</h1>
          <p className="text-white/70 text-sm mt-1">Student Information System</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/20 transition"
                placeholder="Enter your username"
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/20 transition"
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#003087] hover:bg-[#002570] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-60 mt-2"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            Default admin: <span className="font-mono">admin / admin123</span>
          </p>
        </div>
      </div>
    </div>
  );
}
