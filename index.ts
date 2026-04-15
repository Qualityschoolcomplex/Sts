import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import downloadsRouter from "./downloads";
import usersRouter from "./users";
import studentsRouter from "./students";
import classesRouter from "./classes";
import termsRouter from "./terms";
import subjectsRouter from "./subjects";
import resultsRouter from "./results";
import reportsRouter from "./reports";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(downloadsRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(studentsRouter);
router.use(classesRouter);
router.use(termsRouter);
router.use(subjectsRouter);
router.use(resultsRouter);
router.use(reportsRouter);
router.use(dashboardRouter);

export default router;
