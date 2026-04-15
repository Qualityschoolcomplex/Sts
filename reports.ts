import { Router, type IRouter } from "express";
import { eq, and, avg } from "drizzle-orm";
import { db, studentsTable, classesTable, termsTable, resultsTable, subjectsTable, reportsTable } from "@workspace/db";
import { GetStudentReportParams, UpdateReportRemarksParams, UpdateReportRemarksBody } from "@workspace/api-zod";
import { calculateGrade } from "../lib/grading";

const router: IRouter = Router();

router.get("/reports/:studentId/:termId", async (req, res): Promise<void> => {
  const raw1 = Array.isArray(req.params.studentId) ? req.params.studentId[0] : req.params.studentId;
  const raw2 = Array.isArray(req.params.termId) ? req.params.termId[0] : req.params.termId;
  const studentId = parseInt(raw1, 10);
  const termId = parseInt(raw2, 10);

  if (isNaN(studentId) || isNaN(termId)) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  const [student] = await db
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
    .where(eq(studentsTable.id, studentId));

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const [term] = await db.select().from(termsTable).where(eq(termsTable.id, termId));
  if (!term) {
    res.status(404).json({ error: "Term not found" });
    return;
  }

  const results = await db
    .select({
      id: resultsTable.id,
      studentId: resultsTable.studentId,
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
    .leftJoin(subjectsTable, eq(resultsTable.subjectId, subjectsTable.id))
    .leftJoin(classesTable, eq(resultsTable.classId, classesTable.id))
    .leftJoin(termsTable, eq(resultsTable.termId, termsTable.id))
    .where(and(eq(resultsTable.studentId, studentId), eq(resultsTable.termId, termId)));

  const totalMarks = results.reduce((sum, r) => sum + r.totalScore, 0);
  const averageScore = results.length > 0 ? totalMarks / results.length : 0;
  const { grade: overallGrade } = calculateGrade(averageScore);

  const classStudents = student.classId
    ? await db
        .select({ id: studentsTable.id })
        .from(studentsTable)
        .where(eq(studentsTable.classId, student.classId))
    : [];

  const classAverages: { studentId: number; avg: number }[] = [];
  for (const cs of classStudents) {
    const studentResults = await db
      .select({ totalScore: resultsTable.totalScore })
      .from(resultsTable)
      .where(and(eq(resultsTable.studentId, cs.id), eq(resultsTable.termId, termId)));

    if (studentResults.length > 0) {
      const avg = studentResults.reduce((s, r) => s + r.totalScore, 0) / studentResults.length;
      classAverages.push({ studentId: cs.id, avg });
    }
  }

  classAverages.sort((a, b) => b.avg - a.avg);
  const position = classAverages.findIndex((ca) => ca.studentId === studentId) + 1;

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(and(eq(reportsTable.studentId, studentId), eq(reportsTable.termId, termId)));

  const formattedResults = results.map((r) => ({
    ...r,
    studentName: `${student.firstName} ${student.lastName}`,
    subjectName: r.subjectName || "",
    className: r.className || "",
    termName: r.termName || "",
  }));

  res.json({
    student,
    term,
    className: student.className || "",
    results: formattedResults,
    totalMarks,
    averageScore: Math.round(averageScore * 100) / 100,
    overallGrade,
    position: position || 1,
    classSize: classStudents.length,
    teacherRemarks: report?.teacherRemarks || null,
    headteacherRemarks: report?.headteacherRemarks || null,
    conduct: report?.conduct || null,
    interest: report?.interest || null,
    attitude: report?.attitude || null,
    attendance: {
      totalDays: report?.totalDays || 0,
      daysPresent: report?.daysPresent || 0,
    },
    schoolName: "QUALITY SCHOOL COMPLEX",
    schoolContact: "P.O. Box 123, Accra, Ghana | Tel: +233 XX XXX XXXX",
    schoolMotto: "Quality Education for a Better Future",
  });
});

router.put("/reports/:studentId/:termId/remarks", async (req, res): Promise<void> => {
  const raw1 = Array.isArray(req.params.studentId) ? req.params.studentId[0] : req.params.studentId;
  const raw2 = Array.isArray(req.params.termId) ? req.params.termId[0] : req.params.termId;
  const studentId = parseInt(raw1, 10);
  const termId = parseInt(raw2, 10);

  if (isNaN(studentId) || isNaN(termId)) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  const parsed = UpdateReportRemarksBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(reportsTable)
    .where(and(eq(reportsTable.studentId, studentId), eq(reportsTable.termId, termId)));

  if (existing) {
    await db
      .update(reportsTable)
      .set({
        teacherRemarks: parsed.data.teacherRemarks ?? existing.teacherRemarks,
        headteacherRemarks: parsed.data.headteacherRemarks ?? existing.headteacherRemarks,
        conduct: parsed.data.conduct ?? existing.conduct,
        interest: parsed.data.interest ?? existing.interest,
        attitude: parsed.data.attitude ?? existing.attitude,
        totalDays: parsed.data.attendance?.totalDays ?? existing.totalDays,
        daysPresent: parsed.data.attendance?.daysPresent ?? existing.daysPresent,
      })
      .where(eq(reportsTable.id, existing.id));
  } else {
    await db.insert(reportsTable).values({
      studentId,
      termId,
      teacherRemarks: parsed.data.teacherRemarks,
      headteacherRemarks: parsed.data.headteacherRemarks,
      conduct: parsed.data.conduct,
      interest: parsed.data.interest,
      attitude: parsed.data.attitude,
      totalDays: parsed.data.attendance?.totalDays,
      daysPresent: parsed.data.attendance?.daysPresent,
    });
  }

  res.json({ message: "Remarks updated" });
});

export default router;
