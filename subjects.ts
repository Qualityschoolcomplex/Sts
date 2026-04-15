import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, subjectsTable } from "@workspace/db";
import { ListSubjectsQueryParams } from "@workspace/api-zod";
import { GES_SUBJECTS } from "../lib/grading";

const router: IRouter = Router();

router.get("/subjects", async (req, res): Promise<void> => {
  const params = ListSubjectsQueryParams.safeParse(req.query);

  let query = db.select().from(subjectsTable).orderBy(subjectsTable.classLevel, subjectsTable.name);

  if (params.success && params.data.classLevel) {
    const subjects = await db
      .select()
      .from(subjectsTable)
      .where(eq(subjectsTable.classLevel, params.data.classLevel))
      .orderBy(subjectsTable.name);
    res.json(subjects);
    return;
  }

  const subjects = await query;
  res.json(subjects);
});

router.post("/subjects/seed", async (_req, res): Promise<void> => {
  let count = 0;

  for (const [level, subjects] of Object.entries(GES_SUBJECTS)) {
    for (const subject of subjects) {
      const existing = await db
        .select()
        .from(subjectsTable)
        .where(eq(subjectsTable.classLevel, level));

      const found = existing.find(
        (s) => s.name === subject.name && s.classLevel === level
      );

      if (!found) {
        await db.insert(subjectsTable).values({
          name: subject.name,
          classLevel: level,
          isCore: subject.isCore,
        });
        count++;
      }
    }
  }

  res.json({ message: `Seeded ${count} subjects`, count });
});

export default router;
