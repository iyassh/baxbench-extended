import fs from "fs";
import path from "path";
import { globSync } from "glob";

interface ResultRef {
  id: number;
  code_path: string | null;
  scenario: string;
  framework: string;
  safety_prompt: string;
}

const resultMap = new Map<number, ResultRef>();

// Load results data on startup
const dataPath = path.join(__dirname, "..", "data", "results-by-config.json");
const allResults: Record<string, ResultRef[]> = JSON.parse(
  fs.readFileSync(dataPath, "utf8")
);
for (const results of Object.values(allResults)) {
  for (const r of results) {
    resultMap.set(r.id, r);
  }
}

export function getResult(id: number): ResultRef | undefined {
  return resultMap.get(id);
}

export function getSampleDir(codePath: string): string {
  return path.dirname(codePath);
}

export function getConfigDir(codePath: string): string {
  return path.dirname(path.dirname(codePath));
}

export function getGenLogPath(codePath: string): string {
  return path.join(getConfigDir(codePath), "gen.log");
}

export function getTestLogPath(codePath: string): string {
  return path.join(getSampleDir(codePath), "test.log");
}

export function getCodeFiles(codePath: string): { name: string; content: string; language: string }[] {
  if (!fs.existsSync(codePath)) return [];
  const files = fs.readdirSync(codePath).filter((f) => !f.startsWith("."));
  return files.map((f) => {
    const ext = path.extname(f);
    let language = "text";
    if (ext === ".py") language = "python";
    else if (ext === ".js" || ext === ".ts") language = "javascript";
    else if (ext === ".go") language = "go";
    else if (ext === ".json") language = "json";
    else if (ext === ".txt" || ext === ".md") language = "text";
    return {
      name: f,
      content: fs.readFileSync(path.join(codePath, f), "utf8"),
      language,
    };
  });
}

export function getTestLogs(codePath: string): {
  buildLog: string;
  testLogs: { name: string; type: "functional" | "security"; content: string; passed: boolean }[];
} {
  const sampleDir = getSampleDir(codePath);
  let buildLog = "";
  const testLogPath = path.join(sampleDir, "test.log");
  if (fs.existsSync(testLogPath)) {
    buildLog = fs.readFileSync(testLogPath, "utf8");
  }

  const testLogs: { name: string; type: "functional" | "security"; content: string; passed: boolean }[] = [];

  const funcLogs = globSync("func_test_*.log", { cwd: sampleDir });
  for (const f of funcLogs.sort()) {
    const content = fs.readFileSync(path.join(sampleDir, f), "utf8");
    testLogs.push({
      name: f.replace(".log", "").replace("func_test_", ""),
      type: "functional",
      content,
      passed: content.includes("test ok"),
    });
  }

  const secLogs = globSync("sec_test_*.log", { cwd: sampleDir });
  for (const f of secLogs.sort()) {
    const content = fs.readFileSync(path.join(sampleDir, f), "utf8");
    testLogs.push({
      name: f.replace(".log", "").replace("sec_test_", ""),
      type: "security",
      content,
      passed: content.includes("test ok"),
    });
  }

  return { buildLog, testLogs };
}

export function parsePrompt(codePath: string): string {
  const genLogPath = getGenLogPath(codePath);
  if (!fs.existsSync(genLogPath)) return "gen.log not found";

  const content = fs.readFileSync(genLogPath, "utf8");
  const promptStart = content.indexOf("built prompt:");
  if (promptStart === -1) return "Prompt not found in gen.log";

  // Find the separator line after the prompt
  const afterPrompt = content.substring(promptStart + "built prompt:".length);
  const separatorIdx = afterPrompt.indexOf("-----------------------------------");
  if (separatorIdx === -1) return afterPrompt.trim();

  return afterPrompt.substring(0, separatorIdx).trim();
}

console.log(`Loaded ${resultMap.size} results from data`);
