// ============================================================
// FILE: src/lib/logger.ts
// ============================================================

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});


// ============================================================
// FILE: src/routes/health.ts
// ============================================================

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const healthRouter: IRouter = Router();

healthRouter.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export { healthRouter };


// ============================================================
// FILE: src/routes/storage.ts
// ============================================================

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename_storage = fileURLToPath(import.meta.url);
const __dirname_storage = path.dirname(__filename_storage);
const storagePath = path.join(__dirname_storage, "..", "data", "storage.json");

const allowedKeys = new Set([
  "qsc_users",
  "qsc_reports",
  "qsc_report_template",
  "qsc_school_logo",
  "qsc_score_sheets",
  "qsc_student_names",
  "qsc_notifications",
]);

const storageRouter: IRouter = Router();

type Store = Record<string, string>;

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(storagePath, "utf-8");
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return {};
    }
    throw err;
  }
}

async function writeStore(data: Store) {
  await fs.mkdir(path.dirname(storagePath), { recursive: true });
  await fs.writeFile(storagePath, JSON.stringify(data, null, 2));
}

storageRouter.get("/storage", async (req, res, next) => {
  try {
    const data = await readStore();
    const filtered: Store = {};
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(data, key))
        filtered[key] = data[key]!;
    }
    res.json(filtered);
  } catch (err) {
    next(err);
  }
});

storageRouter.put("/storage/:key", async (req, res, next) => {
  try {
    const key = req.params["key"]!;
    if (!allowedKeys.has(key)) {
      res.status(403).json({ error: "key not allowed" });
      return;
    }
    const { value } = req.body as { value?: unknown };
    if (typeof value !== "string") {
      res.status(400).json({ error: "value must be a string" });
      return;
    }
    const data = await readStore();
    data[key] = value;
    await writeStore(data);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

storageRouter.delete("/storage/:key", async (req, res, next) => {
  try {
    const key = req.params["key"]!;
    if (!allowedKeys.has(key)) {
      res.status(403).json({ error: "key not allowed" });
      return;
    }
    const data = await readStore();
    delete data[key];
    await writeStore(data);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export { storageRouter };


// ============================================================
// FILE: src/routes/downloads.ts
// ============================================================

import fssync from "fs";

const __filename_dl = fileURLToPath(import.meta.url);
const __dirname_dl = path.dirname(__filename_dl);

const downloadsDir = path.join(__dirname_dl, "..", "downloads");
const publicDir = path.join(__dirname_dl, "..", "public");

const downloadFiles: Record<string, { path: string; name: string }> = {
  "index-html": { path: path.join(publicDir, "index.html"), name: "index.html" },
  "combined-ts": {
    path: path.join(downloadsDir, "combined-typescript.ts"),
    name: "combined-typescript.ts",
  },
  "app-ts": { path: path.join(downloadsDir, "app.ts"), name: "app.ts" },
  "server-index-ts": {
    path: path.join(downloadsDir, "server-index.ts"),
    name: "index.ts",
  },
  "logger-ts": { path: path.join(downloadsDir, "logger.ts"), name: "logger.ts" },
  "routes-index-ts": {
    path: path.join(downloadsDir, "routes-index.ts"),
    name: "routes-index.ts",
  },
  "health-ts": { path: path.join(downloadsDir, "health.ts"), name: "health.ts" },
  "storage-ts": {
    path: path.join(downloadsDir, "storage.ts"),
    name: "storage.ts",
  },
  "downloads-ts": {
    path: path.join(downloadsDir, "downloads.ts"),
    name: "downloads.ts",
  },
};

const downloadsRouter: IRouter = Router();

downloadsRouter.get("/downloads/:file", (req, res) => {
  const fileKey = req.params["file"];
  if (!fileKey || !(fileKey in downloadFiles)) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  const file = downloadFiles[fileKey as keyof typeof downloadFiles];
  if (!fssync.existsSync(file.path)) {
    res.status(404).json({ error: "download not ready" });
    return;
  }
  res.download(file.path, file.name);
});

downloadsRouter.get("/downloads", (_req, res) => {
  const list = Object.entries(downloadFiles).map(([key, f]) => ({
    key,
    name: f.name,
    url: `/api/downloads/${key}`,
    available: fssync.existsSync(f.path),
  }));
  res.json({ files: list });
});

export { downloadsRouter };


// ============================================================
// FILE: src/routes/index.ts
// ============================================================

const router: IRouter = Router();
router.use(healthRouter);
router.use(storageRouter);
router.use(downloadsRouter);

export default router;


// ============================================================
// FILE: src/app.ts  (updated — gzip compression + HTML caching)
// ============================================================

import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import fsnative from "fs";

const __filename_app = fileURLToPath(import.meta.url);
const __dirname_app = path.dirname(__filename_app);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(compression());
app.use(cors());
app.disable("etag");
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/api", router);

const htmlPath_app = path.join(__dirname_app, "..", "public", "index.html");
let cachedHtml: string | null = null;

function getInjectedHtml(): string {
  if (cachedHtml) return cachedHtml;
  cachedHtml = fsnative.readFileSync(htmlPath_app, "utf-8");
  return cachedHtml;
}

app.get("/favicon.svg", (req, res) => {
  const faviconPath = path.join(__dirname_app, "..", "public", "favicon.svg");
  if (fsnative.existsSync(faviconPath)) {
    res.type("image/svg+xml").sendFile(faviconPath);
  } else {
    res.status(204).end();
  }
});

app.get("/{*path}", (req, res) => {
  try {
    res.type("html").send(getInjectedHtml());
  } catch (err) {
    req.log.error({ err }, "Could not load application HTML");
    res.status(500).send("Could not load application.");
  }
});

export default app;


// ============================================================
// FILE: src/index.ts  (server entry point)
// ============================================================

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
