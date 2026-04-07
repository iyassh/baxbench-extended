#!/usr/bin/env node
/**
 * Export per-config detail files (prompts, code, logs) to public/details/
 * These are fetched on-demand by the dashboard tabs.
 *
 * Output: public/details/{config-name}.json
 * Each file contains a map: resultId -> { prompt, code, logs }
 */
const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");

const DATA_PATH = path.join(__dirname, "..", "data", "results-by-config.json");
const OUT_DIR = path.join(__dirname, "..", "public", "details");

fs.mkdirSync(OUT_DIR, { recursive: true });

const allResults = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

function parsePrompt(codePath) {
  const genLogPath = path.join(codePath, "..", "..", "gen.log");
  if (!fs.existsSync(genLogPath)) return null;
  const content = fs.readFileSync(genLogPath, "utf8");
  const promptStart = content.indexOf("built prompt:");
  if (promptStart === -1) return null;
  const afterPrompt = content.substring(promptStart + "built prompt:".length);
  const separatorIdx = afterPrompt.indexOf("-----------------------------------");
  return separatorIdx === -1 ? afterPrompt.trim() : afterPrompt.substring(0, separatorIdx).trim();
}

function getCodeFiles(codePath) {
  if (!fs.existsSync(codePath)) return [];
  return fs.readdirSync(codePath)
    .filter((f) => !f.startsWith("."))
    .map((f) => {
      const ext = path.extname(f);
      let language = "text";
      if (ext === ".py") language = "python";
      else if (ext === ".js" || ext === ".ts") language = "javascript";
      else if (ext === ".go") language = "go";
      else if (ext === ".json") language = "json";
      return {
        name: f,
        content: fs.readFileSync(path.join(codePath, f), "utf8"),
        language,
      };
    });
}

function getTestLogs(codePath) {
  const sampleDir = path.dirname(codePath);
  let buildLog = "";
  const testLogPath = path.join(sampleDir, "test.log");
  if (fs.existsSync(testLogPath)) {
    // Truncate large logs to keep file sizes reasonable
    const full = fs.readFileSync(testLogPath, "utf8");
    buildLog = full.length > 15000 ? full.substring(0, 15000) + "\n... (truncated)" : full;
  }

  const testLogs = [];

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

console.log("Exporting detail files...\n");

for (const [configName, results] of Object.entries(allResults)) {
  const details = {};
  let skipped = 0;

  for (const r of results) {
    if (!r.code_path || !fs.existsSync(r.code_path)) {
      skipped++;
      continue;
    }

    details[r.id] = {
      prompt: parsePrompt(r.code_path),
      code: getCodeFiles(r.code_path),
      logs: getTestLogs(r.code_path),
    };
  }

  const outPath = path.join(OUT_DIR, `${configName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(details));
  const size = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`  ✓ ${configName}.json (${size} MB, ${Object.keys(details).length} results${skipped ? `, ${skipped} skipped` : ""})`);
}

console.log("\n✅ All detail files exported to public/details/");
