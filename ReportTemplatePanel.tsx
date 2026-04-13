import { useState, useRef } from "react";
import {
  getReportTemplate, saveReportTemplate, ReportTemplate,
  getSchoolLogo, saveSchoolLogo, removeSchoolLogo, DEFAULT_TEMPLATE,
} from "@/lib/storage";

export default function ReportTemplatePanel() {
  const [tmpl, setTmpl] = useState<ReportTemplate>(getReportTemplate());
  const [logo, setLogo] = useState(getSchoolLogo());
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveReportTemplate(tmpl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      alert("File must be under 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = ev.target?.result as string;
      saveSchoolLogo(b64);
      setLogo(b64);
    };
    reader.readAsDataURL(f);
  }

  function handleRemoveLogo() {
    removeSchoolLogo();
    setLogo("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function set(k: keyof ReportTemplate, v: string) {
    setTmpl({ ...tmpl, [k]: v });
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-900">Report Settings</h2>
        <p className="text-sm text-gray-500 mt-0.5">Customize school information shown on report cards</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-4">
        <h3 className="text-base font-semibold text-gray-800 mb-4">School Logo</h3>
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 bg-gray-50 text-center">
          {logo ? (
            <div className="flex flex-col items-center gap-3">
              <img src={logo} alt="School logo" className="max-h-24 max-w-40 object-contain border border-gray-200 rounded-lg p-2 bg-white" />
              <div className="flex gap-2">
                <button onClick={() => fileRef.current?.click()} className="text-sm bg-[#003087] text-white px-3 py-1.5 rounded-lg hover:bg-[#002570] transition">
                  Change
                </button>
                <button onClick={handleRemoveLogo} className="text-sm bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 transition">
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm text-gray-500 mb-3">No logo uploaded</p>
              <button onClick={() => fileRef.current?.click()} className="text-sm bg-[#003087] text-white px-4 py-2 rounded-lg hover:bg-[#002570] transition">
                Upload Logo
              </button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
        </div>
      </div>

      <form onSubmit={handleSave}>
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-800 mb-4">School Information</h3>
          <div className="space-y-4">
            <Field label="School Name" value={tmpl.schoolName} onChange={(v) => set("schoolName", v)} />
            <Field label="School Sub-title (e.g. Nursery, Primary & JHS)" value={tmpl.schoolSub} onChange={(v) => set("schoolSub", v)} />
            <Field label="Address" value={tmpl.address} onChange={(v) => set("address", v)} />
            <Field label="Phone" value={tmpl.phone} onChange={(v) => set("phone", v)} />
            <Field label="Email" value={tmpl.email} onChange={(v) => set("email", v)} />
            <Field label="Motto" value={tmpl.motto} onChange={(v) => set("motto", v)} />
          </div>
          <div className="flex gap-3 mt-6">
            <button type="submit" className="bg-[#003087] text-white font-semibold px-6 py-2.5 rounded-lg text-sm hover:bg-[#002570] transition">
              {saved ? "Saved!" : "Save Settings"}
            </button>
            <button
              type="button"
              onClick={() => setTmpl(DEFAULT_TEMPLATE)}
              className="bg-gray-100 text-gray-700 font-semibold px-4 py-2.5 rounded-lg text-sm hover:bg-gray-200 transition"
            >
              Reset to Default
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#003087]"
      />
    </div>
  );
}
