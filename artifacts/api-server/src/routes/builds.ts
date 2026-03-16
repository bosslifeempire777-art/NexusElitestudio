import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/", (req, res) => {
  const { projectId } = req.query as { projectId?: string };

  const builds = [
    {
      id: "build-1",
      projectId: projectId || "proj-1",
      status: "success",
      startedAt: new Date(Date.now() - 60000 * 5).toISOString(),
      completedAt: new Date(Date.now() - 60000 * 2).toISOString(),
      logs: ["Installing dependencies...", "Building application...", "Running tests...", "Build successful!"],
      deployedUrl: "https://my-app.aistudio.dev",
    },
    {
      id: "build-2",
      projectId: projectId || "proj-1",
      status: "building",
      startedAt: new Date().toISOString(),
      completedAt: null,
      logs: ["Installing dependencies...", "Building application..."],
      deployedUrl: null,
    },
  ];

  const filtered = projectId ? builds.filter((b) => b.projectId === projectId) : builds;
  res.json(filtered);
});

export default router;
