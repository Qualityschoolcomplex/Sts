import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import filesRouter from "./files";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(filesRouter);

export default router;
