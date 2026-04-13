import { Router } from "express";
import fs from "fs";
import path from "path";

const router = Router();

// process.cwd() is /home/runner/workspace/artifacts/api-server when the server runs
const ROOT = path.resolve(process.cwd(), "../..");

const DOWNLOAD_FILES: Record<string, { disk: string; name: string; label: string }> = {
  "App.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/App.tsx"),
    name: "App.tsx",
    label: "App root (src/App.tsx)",
  },
  "storage.ts": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/lib/storage.ts"),
    name: "storage.ts",
    label: "Data layer (src/lib/storage.ts)",
  },
  "LoginPage.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/pages/LoginPage.tsx"),
    name: "LoginPage.tsx",
    label: "Login page (src/pages/LoginPage.tsx)",
  },
  "AdminDashboard.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/pages/AdminDashboard.tsx"),
    name: "AdminDashboard.tsx",
    label: "Admin dashboard (src/pages/AdminDashboard.tsx)",
  },
  "StaffDashboard.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/pages/StaffDashboard.tsx"),
    name: "StaffDashboard.tsx",
    label: "Staff dashboard (src/pages/StaffDashboard.tsx)",
  },
  "not-found.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/pages/not-found.tsx"),
    name: "not-found.tsx",
    label: "404 page (src/pages/not-found.tsx)",
  },
  "ManageUsers.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/components/admin/ManageUsers.tsx"),
    name: "ManageUsers.tsx",
    label: "Admin — Manage Users",
  },
  "AdminScoreSheets.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/components/admin/AdminScoreSheets.tsx"),
    name: "AdminScoreSheets.tsx",
    label: "Admin — Score Sheets",
  },
  "AdminGenerateReport.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/components/admin/AdminGenerateReport.tsx"),
    name: "AdminGenerateReport.tsx",
    label: "Admin — Generate Report",
  },
  "ReportTemplatePanel.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/components/admin/ReportTemplatePanel.tsx"),
    name: "ReportTemplatePanel.tsx",
    label: "Admin — Report Settings",
  },
  "ReportCardPrint.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/components/shared/ReportCardPrint.tsx"),
    name: "ReportCardPrint.tsx",
    label: "Shared — Report Card Print",
  },
  "ScoreSheetManager.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/components/staff/ScoreSheetManager.tsx"),
    name: "ScoreSheetManager.tsx",
    label: "Staff — Score Sheet Manager",
  },
  "StaffGenerateReport.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/components/staff/StaffGenerateReport.tsx"),
    name: "StaffGenerateReport.tsx",
    label: "Staff — Generate Report",
  },
  "StudentNamesPanel.tsx": {
    disk: path.join(ROOT, "artifacts/qsc-sis/src/components/staff/StudentNamesPanel.tsx"),
    name: "StudentNamesPanel.tsx",
    label: "Staff — Student Names",
  },
  "api-app.ts": {
    disk: path.join(ROOT, "artifacts/api-server/src/app.ts"),
    name: "api-app.ts",
    label: "API Server entry (api-server/src/app.ts)",
  },
  "api-index.ts": {
    disk: path.join(ROOT, "artifacts/api-server/src/index.ts"),
    name: "api-index.ts",
    label: "API Server main (api-server/src/index.ts)",
  },
  "routes-index.ts": {
    disk: path.join(ROOT, "artifacts/api-server/src/routes/index.ts"),
    name: "routes-index.ts",
    label: "Routes index (routes/index.ts)",
  },
  "routes-storage.ts": {
    disk: path.join(ROOT, "artifacts/api-server/src/routes/storage.ts"),
    name: "routes-storage.ts",
    label: "Storage routes (routes/storage.ts)",
  },
  "routes-files.ts": {
    disk: path.join(ROOT, "artifacts/api-server/src/routes/files.ts"),
    name: "routes-files.ts",
    label: "File download routes (routes/files.ts)",
  },
  "schema-storage.ts": {
    disk: path.join(ROOT, "lib/db/src/schema/storage.ts"),
    name: "schema-storage.ts",
    label: "DB schema (lib/db/src/schema/storage.ts)",
  },
  "db-index.ts": {
    disk: path.join(ROOT, "lib/db/src/index.ts"),
    name: "db-index.ts",
    label: "DB index (lib/db/src/index.ts)",
  },
};

const COMBINED_KEYS = Object.keys(DOWNLOAD_FILES);

// ─── Downloads HTML page ───
router.get("/downloads", (_req, res) => {
  const rows = Object.entries(DOWNLOAD_FILES)
    .map(([key, entry]) => {
      return `<li style="margin:10px 0">
        <a href="/api/downloads/${encodeURIComponent(key)}" download="${entry.name}"
           style="font-family:monospace;font-size:15px;color:#003087;text-decoration:none;border-bottom:1px solid #003087;">
          ${entry.name}
        </a>
        <span style="font-size:12px;color:#555;margin-left:10px;">${entry.label}</span>
      </li>`;
    })
    .join("");

  const combinedRow = `<li style="margin:10px 0">
    <a href="/api/downloads/combined.ts" download="combined.ts"
       style="font-family:monospace;font-size:15px;color:#003087;text-decoration:none;border-bottom:1px solid #003087;">
      combined.ts
    </a>
    <span style="font-size:12px;color:#555;margin-left:10px;">All source files merged into one</span>
  </li>`;

  res.type("html").send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Download Files — QSC SIS</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 48px; background: #f5f7fa; }
    h2 { color: #003087; margin-bottom: 6px; }
    p { color: #555; margin-top: 0; font-size: 14px; }
    ul { list-style: none; padding: 24px 28px; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
    a:hover { color: #0052cc !important; }
  </style>
</head>
<body>
  <h2>QSC SIS — Updated Source Files</h2>
  <p>Click any file to download it individually, or grab <strong>combined.ts</strong> to get everything in one file.</p>
  <ul>
    ${rows}
    <hr />
    ${combinedRow}
  </ul>
</body>
</html>`);
});

// ─── Combined .ts download ───
router.get("/downloads/combined.ts", (_req, res) => {
  const divider = "// " + "=".repeat(60);
  const parts = COMBINED_KEYS.map((key) => {
    const entry = DOWNLOAD_FILES[key]!;
    if (!fs.existsSync(entry.disk)) return "";
    const content = fs.readFileSync(entry.disk, "utf-8");
    return `${divider}\n// FILE: ${entry.name}\n${divider}\n\n${content}`;
  }).filter(Boolean);

  res.setHeader("Content-Disposition", 'attachment; filename="combined.ts"');
  res.type("text/plain").send(parts.join("\n\n"));
});

// ─── Individual file download ───
router.get("/downloads/:file", (req, res) => {
  const key = req.params.file;
  const entry = DOWNLOAD_FILES[key];
  if (!entry) { res.status(404).send("File not found"); return; }
  if (!fs.existsSync(entry.disk)) { res.status(404).send("File does not exist on disk"); return; }
  res.download(entry.disk, entry.name);
});

export default router;
