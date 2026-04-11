import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import projectsRouter from "./projects.js";
import agentsRouter from "./agents.js";
import marketplaceRouter from "./marketplace.js";
import usersRouter from "./users.js";
import plansRouter from "./plans.js";
import analyticsRouter from "./analytics.js";
import buildsRouter from "./builds.js";
import stripeRouter from "./stripe.js";
import adminRouter from "./admin.js";
import charactersRouter from "./characters.js";
import referralsRouter from "./referrals.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/projects", projectsRouter);
router.use("/agents", agentsRouter);
router.use("/marketplace", marketplaceRouter);
router.use("/users", usersRouter);
router.use("/plans", plansRouter);
router.use("/analytics", analyticsRouter);
router.use("/builds", buildsRouter);
router.use("/stripe", stripeRouter);
router.use("/admin", adminRouter);
router.use("/characters", charactersRouter);
router.use("/referrals", referralsRouter);

export default router;
