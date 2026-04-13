import { useState, useEffect } from "react";
import { getUsers, saveUsers, User } from "@/lib/storage";

interface Props {
  currentUser: User;
}

export default function ManageUsers({ currentUser }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  useEffect(() => {
    setUsers(getUsers());
  }, []);

  function refresh() {
    setUsers(getUsers());
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.username.toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q);
  });

  function handleDelete(username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    const updated = getUsers().filter((u) => u.username !== username);
    saveUsers(updated);
    refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Manage User Credentials</h2>
          <p className="text-sm text-gray-500 mt-0.5">Add, edit or remove staff and admin accounts</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-[#003087] hover:bg-[#002570] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Add User
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or username…"
          className="w-full sm:w-80 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]"
        />
      </div>

      {/* User cards */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No users found</div>
        ) : (
          filtered.map((u) => (
            <div key={u.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#003087]/10 flex items-center justify-center font-bold text-[#003087] text-sm">
                  {(u.displayName || u.username).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-gray-900 text-sm">{u.displayName || u.username}</div>
                  <div className="text-xs text-gray-500 font-mono">{u.username}</div>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.role === "admin" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"
                  }`}>
                    {u.role}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditUser(u)}
                  className="bg-[#003087] hover:bg-[#002570] text-white text-sm font-medium px-3 py-1.5 rounded-lg transition"
                >
                  Edit
                </button>
                {u.username !== currentUser.username && (
                  <button
                    onClick={() => handleDelete(u.username)}
                    className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-sm font-medium px-3 py-1.5 rounded-lg transition"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showAdd && <AddUserModal onClose={() => { setShowAdd(false); refresh(); }} />}
      {editUser && <EditUserModal user={editUser} currentUser={currentUser} onClose={() => { setEditUser(null); refresh(); }} />}
    </div>
  );
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ displayName: "", username: "", password: "", role: "staff" as "admin" | "staff" });
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.username.trim() || !form.password.trim()) {
      setError("Username and password are required.");
      return;
    }
    const users = getUsers();
    if (users.find((u) => u.username === form.username.trim())) {
      setError("Username already exists.");
      return;
    }
    users.push({
      id: "u_" + Date.now(),
      username: form.username.trim(),
      password: form.password,
      displayName: form.displayName.trim() || form.username.trim(),
      role: form.role,
    });
    saveUsers(users);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7">
        <h3 className="text-lg font-bold text-gray-900 mb-5">Add New User</h3>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Display Name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} placeholder="e.g. John Doe" />
          <Field label="Username *" value={form.username} onChange={(v) => setForm({ ...form, username: v })} placeholder="unique username" />
          <Field label="Password *" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" placeholder="password" />
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Role *</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "staff" })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none"
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="flex-1 bg-[#003087] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[#002570] transition">
              Add User
            </button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-lg text-sm hover:bg-gray-200 transition">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ user, currentUser, onClose }: { user: User; currentUser: User; onClose: () => void }) {
  const [form, setForm] = useState({
    displayName: user.displayName || "",
    username: user.username,
    password: user.password,
    role: user.role,
  });
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.username.trim() || !form.password.trim()) {
      setError("Username and password are required.");
      return;
    }
    const users = getUsers();
    const conflict = users.find((u) => u.username === form.username.trim() && u.id !== user.id);
    if (conflict) {
      setError("Username already taken by another user.");
      return;
    }
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx < 0) return;
    users[idx] = {
      ...users[idx],
      username: form.username.trim(),
      password: form.password,
      displayName: form.displayName.trim() || form.username.trim(),
      role: form.role as "admin" | "staff",
    };
    saveUsers(users);

    // Update current session if editing self
    if (currentUser.id === user.id) {
      const updatedSelf = users[idx];
      localStorage.setItem("qsc_current_user", JSON.stringify(updatedSelf));
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7">
        <h3 className="text-lg font-bold text-gray-900 mb-5">Edit User</h3>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Display Name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} placeholder="e.g. John Doe" />
          <Field label="Username *" value={form.username} onChange={(v) => setForm({ ...form, username: v })} placeholder="unique username" />
          <Field label="Password *" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" placeholder="password" />
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Role *</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "staff" })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none"
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="flex-1 bg-[#003087] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[#002570] transition">
              Save Changes
            </button>
            <button type="button" onClick={onClose} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-lg text-sm hover:bg-gray-200 transition">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]"
      />
    </div>
  );
}
