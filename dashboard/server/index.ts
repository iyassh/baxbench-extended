import express from "express";
import cors from "cors";
import {
  getResult,
  getCodeFiles,
  getTestLogs,
  parsePrompt,
} from "./paths";
import { checkDocker, buildAndRun, stopContainer, cleanupAll } from "./docker";

const app = express();
const PORT = 3001;

app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, docker: checkDocker() });
});

// Get prompt for a result
app.get("/api/result/:id/prompt", (req, res) => {
  const result = getResult(Number(req.params.id));
  if (!result || !result.code_path) {
    return res.status(404).json({ error: "Result not found" });
  }
  const prompt = parsePrompt(result.code_path);
  res.json({ prompt });
});

// Get code files for a result
app.get("/api/result/:id/code", (req, res) => {
  const result = getResult(Number(req.params.id));
  if (!result || !result.code_path) {
    return res.status(404).json({ error: "Result not found" });
  }
  const files = getCodeFiles(result.code_path);
  res.json({ files });
});

// Get logs for a result
app.get("/api/result/:id/logs", (req, res) => {
  const result = getResult(Number(req.params.id));
  if (!result || !result.code_path) {
    return res.status(404).json({ error: "Result not found" });
  }
  const logs = getTestLogs(result.code_path);
  res.json(logs);
});

// Start Docker preview
app.post("/api/result/:id/preview/start", async (req, res) => {
  const result = getResult(Number(req.params.id));
  if (!result || !result.code_path) {
    return res.status(404).json({ error: "Result not found" });
  }
  if (!checkDocker()) {
    return res.status(503).json({ error: "Docker is not available" });
  }
  try {
    const { port, containerId } = await buildAndRun(
      result.code_path,
      result.framework
    );
    res.json({ port, containerId });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to start container" });
  }
});

// Stop Docker preview
app.post("/api/result/:id/preview/stop", (req, res) => {
  const { containerId } = req.body;
  if (!containerId) {
    return res.status(400).json({ error: "containerId required" });
  }
  stopContainer(containerId);
  res.json({ ok: true });
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nStopping all preview containers...");
  cleanupAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupAll();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Preview server running on http://localhost:${PORT}`);
  console.log(`Docker available: ${checkDocker()}`);
});
