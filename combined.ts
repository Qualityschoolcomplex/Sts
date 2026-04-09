// ============================================================
// FILE: app.ts
// ============================================================

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

const syncScript = `
<script>
(function(){
  var SYNC_KEYS = ["qsc_users","qsc_reports","qsc_report_template","qsc_school_logo"];
  var API_BASE = "/api/storage";
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", API_BASE, false);
    xhr.send();
    if (xhr.status === 200) {
      var data = JSON.parse(xhr.responseText);
      for (var i = 0; i < SYNC_KEYS.length; i++) {
        var k = SYNC_KEYS[i];
        if (data.hasOwnProperty(k)) {
          localStorage.setItem(k, data[k]);
        } else {
          localStorage.removeItem(k);
        }
      }
    }
  } catch(e) { console.warn("Failed to preload data from server:", e); }
  var origSetItem = localStorage.setItem.bind(localStorage);
  var origRemoveItem = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    origSetItem(key, value);
    if (SYNC_KEYS.indexOf(key) !== -1) {
      fetch(API_BASE + "/" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: value })
      }).catch(function(){});
    }
  };
  localStorage.removeItem = function(key) {
    origRemoveItem(key);
    if (SYNC_KEYS.indexOf(key) !== -1) {
      fetch(API_BASE + "/" + encodeURIComponent(key), {
        method: "DELETE"
      }).catch(function(){});
    }
  };
})();
</script>
`;

let cachedHtml: string | null = null;

function getInjectedHtml(): string {
  if (cachedHtml) return cachedHtml;
  const htmlPath = path.join(__dirname, "..", "public", "index.html");
  const raw = fs.readFileSync(htmlPath, "utf-8");
  cachedHtml = raw.replace("<head>", "<head>" + syncScript);
  return cachedHtml;
}

const DOWNLOAD_FILES: Record<string, { disk: string; name: string }> = {
  "app.ts": {
    disk: path.join(__dirname, "..", "src", "app.ts"),
    name: "app.ts",
  },
  "routes-storage.ts": {
    disk: path.join(__dirname, "..", "src", "routes", "storage.ts"),
    name: "routes-storage.ts",
  },
  "routes-index.ts": {
    disk: path.join(__dirname, "..", "src", "routes", "index.ts"),
    name: "routes-index.ts",
  },
  "schema-storage.ts": {
    disk: path.join(__dirname, "..", "..", "..", "lib", "db", "src", "schema", "storage.ts"),
    name: "schema-storage.ts",
  },
  "schema-index.ts": {
    disk: path.join(__dirname, "..", "..", "..", "lib", "db", "src", "schema", "index.ts"),
    name: "schema-index.ts",
  },
  "index.html": {
    disk: path.join(__dirname, "..", "public", "index.html"),
    name: "index.html",
  },
};

const TS_FILES = ["app.ts", "routes-storage.ts", "routes-index.ts", "schema-storage.ts", "schema-index.ts"];

app.get("/downloads/combined.ts", (req, res) => {
  const parts = TS_FILES.map((key) => {
    const entry = DOWNLOAD_FILES[key]!;
    const content = fs.readFileSync(entry.disk, "utf-8");
    const divider = "// " + "=".repeat(60);
    return `${divider}\n// FILE: ${entry.name}\n${divider}\n\n${content}`;
  });
  const combined = parts.join("\n\n");
  res.setHeader("Content-Disposition", 'attachment; filename="combined.ts"');
  res.type("text/plain").send(combined);
});

app.get("/downloads", (req, res) => {
  const tsRow = `<li style="margin:10px 0"><a href="/downloads/combined.ts" download style="font-family:monospace;font-size:15px;color:#003087;text-decoration:none;border-bottom:1px solid #003087">combined.ts</a> <span style="font-size:12px;color:#555">(all .ts files in one)</span></li>`;
  const htmlRow = `<li style="margin:10px 0"><a href="/downloads/index.html" download style="font-family:monospace;font-size:15px;color:#003087;text-decoration:none;border-bottom:1px solid #003087">index.html</a></li>`;
  res.type("html").send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Download Updated Files</title>
<style>body{font-family:Arial,sans-serif;padding:40px;background:#f5f7fa}h2{color:#003087}ul{list-style:none;padding:0}</style>
</head><body><h2>Updated Files — Download Individually</h2><ul>${tsRow}${htmlRow}</ul></body></html>`);
});

app.get("/downloads/:file", (req, res) => {
  const entry = DOWNLOAD_FILES[req.params.file];
  if (!entry) { res.status(404).send("Not found"); return; }
  res.download(entry.disk, entry.name);
});

app.get("/favicon.svg", (req, res) => {
  const faviconPath = path.join(__dirname, "..", "public", "favicon.svg");
  if (fs.existsSync(faviconPath)) {
    res.type("image/svg+xml").sendFile(faviconPath);
  } else {
    res.status(204).end();
  }
});

app.get("/", (req, res) => {
  res.type("html").send(getInjectedHtml());
});

export default app;


// ============================================================
// FILE: routes-storage.ts
// ============================================================

import { Router } from "express";
import { db } from "@workspace/db";
import { kvStore } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const ALLOWED_KEYS = new Set([
  "qsc_users",
  "qsc_reports",
  "qsc_report_template",
  "qsc_school_logo",
]);

const router = Router();

router.get("/storage", async (req, res) => {
  const rows = await db
    .select()
    .from(kvStore)
    .where(inArray(kvStore.key, [...ALLOWED_KEYS]));
  const data: Record<string, string> = {};
  for (const row of rows) {
    data[row.key] = row.value;
  }
  res.json(data);
});

router.put("/storage/:key", async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) {
    res.status(403).json({ error: "key not allowed" });
    return;
  }
  const { value } = req.body;
  if (typeof value !== "string") {
    res.status(400).json({ error: "value must be a string" });
    return;
  }
  await db
    .insert(kvStore)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: kvStore.key,
      set: { value, updatedAt: new Date() },
    });
  res.json({ ok: true });
});

router.delete("/storage/:key", async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) {
    res.status(403).json({ error: "key not allowed" });
    return;
  }
  await db.delete(kvStore).where(eq(kvStore.key, key));
  res.json({ ok: true });
});

export default router;


// ============================================================
// FILE: routes-index.ts
// ============================================================

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);

export default router;


// ============================================================
// FILE: schema-storage.ts
// ============================================================

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const kvStore = pgTable("kv_store", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});


// ============================================================
// FILE: schema-index.ts
// ============================================================

export * from "./storage";
