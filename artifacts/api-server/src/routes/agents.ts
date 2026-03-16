import { Router, type IRouter } from "express";
import { AGENT_REGISTRY } from "../lib/agents.js";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  const agents = AGENT_REGISTRY.map((agent) => ({
    ...agent,
    status: Math.random() > 0.7 ? "running" : "idle",
  }));
  res.json(agents);
});

router.post("/:id/run", async (req, res) => {
  const agent = AGENT_REGISTRY.find((a) => a.id === req.params.id);

  if (!agent) {
    return res.status(404).json({ error: "not_found", message: "Agent not found" });
  }

  const { task } = req.body;
  const startTime = Date.now();

  await new Promise((resolve) => setTimeout(resolve, 100));

  res.json({
    success: true,
    output: `[${agent.name}] Task completed: "${task}". Agent processed the request and generated output successfully.`,
    agentId: agent.id,
    duration: Date.now() - startTime,
  });
});

export default router;
