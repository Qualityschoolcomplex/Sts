import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, resultsTable, studentsTable, subjectsTable, classesTable, termsTable } from "@workspace/db";
import {
  CreateResultBody,
  BatchCreateResultsBody,
  UpdateResultBody,
  UpdateResultParams,
  DeleteResultParams,
  ListResultsQueryParams,
} from "@workspace/api-zod";
import { calculateGrade } from "../lib/grading";

const router: IRouter = Router();

router.get("/results", async (req, res): Promise<void> => {
  const params = ListResultsQueryParams.safeParse(req.query);

  const conditions = [];
  if (params.success) {
    if (params.data.studentId) conditions.push(eq(resultsTable.studentId, params.data.studentId));
    if (params.data.classId) conditions.push(eq(resultsTable.classId, params.data.classId));
    if (params.data.termId) conditions.push(eq(resultsTable.termId, params.data.termId));
    if (params.data.subjectId) conditions.push(eq(resultsTable.subjectId, params.data.subjectId));
  }

  const query = db
    .select({
      id: resultsTable.id,
      studentId: resultsTable.studentId,
      studentName: studentsTable.firstName,
      subjectId: resultsTable.subjectId,
      subjectName: subjectsTable.name,
      classId: resultsTable.classId,
      className: classesTable.name,
      termId: resultsTable.termId,
      termName: termsTable.name,
      classScore: resultsTable.classScore,
      examScore: resultsTable.examScore,
      totalScore: resultsTable.totalScore,
      grade: resultsTable.grade,
      remarks: resultsTable.remarks,
    })
    .from(resultsTable)
    .leftJoin(studentsTable, eq(resultsTable.studentId, studentsTable.id))
    .leftJoin(subjectsTable, eq(resultsTable.subjectId, subjectsTable.id))
    .leftJoin(classesTable, eq(resultsTable.classId, classesTable.id))
    .leftJoin(termsTable, eq(resultsTable.termId, termsTable.id));

  if (conditions.length > 0) {
    query.where(and(...conditions));
  }

  const results = await query;

  const formatted = results.map((r) => ({
    ...r,
    studentName: r.studentName || "",
    subjectName: r.subjectName || "",
    className: r.className || "",
    termName: r.termName || "",
  }));

  res.json(formatted);
});

router.post("/results", async (req, res): Promise<void> => {
  const parsed = CreateResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const totalScore = parsed.data.classScore + parsed.data.examScore;
  const { grade, remarks } = calculateGrade(totalScore);

  const [result] = await db
    .insert(resultsTable)
    .values({
      ...parsed.data,
      totalScore,
      grade,
      remarks,
    })
    .returning();

  res.status(201).json(result);
});

router.post("/results/batch", async (req, res): Promise<void> => {
  const parsed = BatchCreateResultsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const insertValues = parsed.data.results.map((r) => {
    const totalScore = r.classScore + r.examScore;
    const { grade, remarks } = calculateGrade(totalScore);
    return { ...r, totalScore, grade, remarks };
  });

  const results = await db.insert(resultsTable).values(insertValues).returning();
  res.status(201).json(results);
});

router.put("/results/:id", async (req, res): Promise<void> => {
  const params = UpdateResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(resultsTable)
    .where(eq(resultsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  const classScore = parsed.data.classScore ?? existing.classScore;
  const examScore = parsed.data.examScore ?? existing.examScore;
  const totalScore = classScore + examScore;
  const { grade, remarks } = calculateGrade(totalScore);

  const [result] = await db
    .update(resultsTable)
    .set({ classScore, examScore, totalScore, grade, remarks })
    .where(eq(resultsTable.id, params.data.id))
    .returning();

  res.json(result);
});

router.delete("/results/:id", async (req, res): Promise<void> => {
  const params = DeleteResultParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [result] = await db
    .delete(resultsTable)
    .where(eq(resultsTable.id, params.data.id))
    .returning();

  if (!result) {
    res.status(404).json({ error: "Result not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
