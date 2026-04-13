import { useState, useEffect } from "react";
import { getStudentNames, saveStudentNames } from "@/lib/storage";

export default function StudentNamesPanel() {
  const [names, setNames] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { setNames(getStudentNames()); }, []);

  function handleAdd() {
    const v = input.trim();
    if (!v) return;
    const updated = [...getStudentNames()];
    if (!updated.includes(v)) {
      updated.push(v);
      saveStudentNames(updated);
      setNames(updated);
    }
    setInput("");
    setShowAdd(false);
  }

  function handleRemove(idx: number) {
    const updated = names.filter((_, i) => i !== idx);
    saveStudentNames(updated);
    setNames(updated);
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Student Names</h2>
          <p className="text-sm text-gray-500 mt-0.5">Saved names appear as suggestions when creating score sheets and reports</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-[#003087] hover:bg-[#002570] text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Add Name
        </button>
      </div>

      {showAdd && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setShowAdd(false); }}
              placeholder="Student full name…"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]"
              autoFocus
            />
            <button onClick={handleAdd} className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
              Save
            </button>
            <button onClick={() => { setShowAdd(false); setInput(""); }} className="bg-gray-100 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-200 transition">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        {names.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No student names saved yet. Click "+ Add Name" to get started.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {names.map((name, i) => (
              <div key={i} className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-full px-3 py-1.5">
                <span className="text-sm text-blue-900 font-medium">{name}</span>
                <button
                  onClick={() => handleRemove(i)}
                  className="text-blue-400 hover:text-red-500 text-sm leading-none transition"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {names.length > 0 && (
        <p className="text-xs text-gray-400 mt-2 text-center">{names.length} name{names.length !== 1 ? "s" : ""} saved</p>
      )}
    </div>
  );
}
