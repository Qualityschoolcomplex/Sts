import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, termsTable } from "@workspace/db";
import { CreateTermBody, UpdateTermBody, UpdateTermParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/terms", async (_req, res): Promise<void> => {
  const terms = await db.select().from(termsTable).orderBy(termsTable.academicYear, termsTable.termNumber);
  res.json(terms);
});

router.post("/terms", async (req, res): Promise<void> => {
  const parsed = CreateTermBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.isActive) {
    await db.update(termsTable).set({ isActive: false });
  }

  const [term] = await db.insert(termsTable).values(parsed.data).returning();
  res.status(201).json(term);
});

router.put("/terms/:id", async (req, res): Promise<void> => {
  const params = UpdateTermParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTermBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.isActive) {
    await db.update(termsTable).set({ isActive: false });
  }

  const [term] = await db
    .update(termsTable)
    .set(parsed.data)
    .where(eq(termsTable.id, params.data.id))
    .returning();

  if (!term) {
    res.status(404).json({ error: "Term not found" });
    return;
  }

  res.json(term);
});

router.get("/terms/active", async (_req, res): Promise<void> => {
  const [term] = await db.select().from(termsTable).where(eq(termsTable.isActive, true));
  if (!term) {
    res.status(404).json({ error: "No active term" });
    return;
  }
  res.json(term);
});

export default router;
