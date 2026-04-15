import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, classesTable, studentsTable } from "@workspace/db";
import {
  CreateClassBody,
  UpdateClassBody,
  UpdateClassParams,
  DeleteClassParams,
  ListClassStudentsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/classes", async (_req, res): Promise<void> => {
  const classes = await db
    .select({
      id: classesTable.id,
      name: classesTable.name,
      level: classesTable.level,
      section: classesTable.section,
      teacherName: classesTable.teacherName,
      studentCount: sql<number>`cast(count(${studentsTable.id}) as integer)`,
    })
    .from(classesTable)
    .leftJoin(studentsTable, eq(classesTable.id, studentsTable.classId))
    .groupBy(classesTable.id)
    .orderBy(classesTable.level, classesTable.name);

  res.json(classes);
});

router.post("/classes", async (req, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [cls] = await db
    .insert(classesTable)
    .values(parsed.data)
    .returning();

  res.status(201).json({ ...cls, studentCount: 0 });
});

router.put("/classes/:id", async (req, res): Promise<void> => {
  const params = UpdateClassParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [cls] = await db
    .update(classesTable)
    .set(parsed.data)
    .where(eq(classesTable.id, params.data.id))
    .returning();

  if (!cls) {
    res.status(404).json({ error: "Class not found" });
    return;
  }

  const [result] = await db
    .select({
      id: classesTable.id,
      name: classesTable.name,
      level: classesTable.level,
      section: classesTable.section,
      teacherName: classesTable.teacherName,
      studentCount: sql<number>`cast(count(${studentsTable.id}) as integer)`,
    })
    .from(classesTable)
    .leftJoin(studentsTable, eq(classesTable.id, studentsTable.classId))
    .where(eq(classesTable.id, params.data.id))
    .groupBy(classesTable.id);

  res.json(result);
});

router.delete("/classes/:id", async (req, res): Promise<void> => {
  const params = DeleteClassParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [cls] = await db
    .delete(classesTable)
    .where(eq(classesTable.id, params.data.id))
    .returning();

  if (!cls) {
    res.status(404).json({ error: "Class not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/classes/:id/students", async (req, res): Promise<void> => {
  const params = ListClassStudentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const students = await db
    .select({
      id: studentsTable.id,
      firstName: studentsTable.firstName,
      lastName: studentsTable.lastName,
      dateOfBirth: studentsTable.dateOfBirth,
      gender: studentsTable.gender,
      guardianName: studentsTable.guardianName,
      guardianPhone: studentsTable.guardianPhone,
      address: studentsTable.address,
      classId: studentsTable.classId,
      className: classesTable.name,
      enrollmentDate: studentsTable.enrollmentDate,
      createdAt: studentsTable.createdAt,
    })
    .from(studentsTable)
    .leftJoin(classesTable, eq(studentsTable.classId, classesTable.id))
    .where(eq(studentsTable.classId, params.data.id))
    .orderBy(studentsTable.lastName, studentsTable.firstName);

  res.json(students);
});

export default router;
