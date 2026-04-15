import { Router, type IRouter } from "express";
import { eq, sql, desc, avg } from "drizzle-orm";
import { db, studentsTable, classesTable, usersTable, termsTable, resultsTable } from "@workspace/db";
import { GetClassPerformanceQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [studentCount] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(studentsTable);

  const [classCount] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(classesTable);

  const [staffCount] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(usersTable);

  const [activeTerm] = await db
    .select()
    .from(termsTable)
    .where(eq(termsTable.isActive, true));

  const genderCounts = await db
    .select({
      gender: studentsTable.gender,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(studentsTable)
    .groupBy(studentsTable.gender);

  const male = genderCounts.find((g) => g.gender === "male")?.count || 0;
  const female = genderCounts.find((g) => g.gender === "female")?.count || 0;

  const levelCounts = await db
    .select({
      level: classesTable.level,
      count: sql<number>`cast(count(${studentsTable.id}) as integer)`,
    })
    .from(studentsTable)
    .leftJoin(classesTable, eq(studentsTable.classId, classesTable.id))
    .groupBy(classesTable.level);

  res.json({
    totalStudents: studentCount.count,
    totalClasses: classCount.count,
    totalStaff: staffCount.count,
    activeTerm: activeTerm ? activeTerm.name : null,
    studentsByGender: { male, female },
    studentsByLevel: levelCounts.map((l) => ({
      level: l.level || "Unassigned",
      count: l.count,
    })),
  });
});

router.get("/dashboard/class-performance", async (req, res): Promise<void> => {
  const params = GetClassPerformanceQueryParams.safeParse(req.query);
  let termId: number | undefined;

  if (params.success && params.data.termId) {
    termId = params.data.termId;
  } else {
    const [activeTerm] = await db.select().from(termsTable).where(eq(termsTable.isActive, true));
    if (activeTerm) termId = activeTerm.id;
  }

  if (!termId) {
    res.json([]);
    return;
  }

  const performance = await db
    .select({
      classId: classesTable.id,
      className: classesTable.name,
      averageScore: sql<number>`round(cast(avg(${resultsTable.totalScore}) as numeric), 2)`,
      totalStudents: sql<number>`cast(count(distinct ${resultsTable.studentId}) as integer)`,
    })
    .from(resultsTable)
    .leftJoin(classesTable, eq(resultsTable.classId, classesTable.id))
    .where(eq(resultsTable.termId, termId))
    .groupBy(classesTable.id, classesTable.name);

  res.json(performance);
});

router.get("/dashboard/recent-enrollments", async (_req, res): Promise<void> => {
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
    .orderBy(desc(studentsTable.createdAt))
    .limit(10);

  res.json(students);
});

export default router;
