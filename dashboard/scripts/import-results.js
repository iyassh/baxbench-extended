#!/usr/bin/env node
/**
 * Import test_results.json files from results/ into the SQLite database.
 *
 * Path structure: results/{config}/{model_id}/{scenario}/{framework}/temp0.2-openapi-{safety_prompt}/sample{n}/test_results.json
 *
 * Usage: node scripts/import-results.js
 */
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "baxbench.db");
const RESULTS_DIR = path.join(__dirname, "..", "..", "results");

if (!fs.existsSync(RESULTS_DIR)) {
  console.error("Results directory not found at", RESULTS_DIR);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Clear existing results
db.exec("DELETE FROM result_cwes");
db.exec("DELETE FROM results");

const insertResult = db.prepare(`
  INSERT OR IGNORE INTO results (config_id, scenario, framework, safety_prompt, sample, functional_pass, num_passed_ft, num_total_ft, num_ft_exceptions, num_total_st, num_st_exceptions, code_path)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertCwe = db.prepare(`
  INSERT INTO result_cwes (result_id, cwe_num, cwe_desc) VALUES (?, ?, ?)
`);

const getConfig = db.prepare("SELECT id FROM configs WHERE name = ?");

// Walk results directory
const configDirs = fs.readdirSync(RESULTS_DIR).filter(d => {
  const full = path.join(RESULTS_DIR, d);
  return fs.statSync(full).isDirectory() && !d.startsWith(".");
});

let totalImported = 0;
let totalCwes = 0;
let skipped = 0;

const importAll = db.transaction(() => {
  for (const configName of configDirs) {
    const configRow = getConfig.get(configName);
    if (!configRow) {
      console.log(`  ⚠ Config "${configName}" not in database, skipping`);
      skipped++;
      continue;
    }
    const configId = configRow.id;
    const configPath = path.join(RESULTS_DIR, configName);

    // Walk: {model_id}/{scenario}/{framework}/temp0.2-openapi-{safety}/sample{n}/test_results.json
    const modelDirs = fs.readdirSync(configPath).filter(d => fs.statSync(path.join(configPath, d)).isDirectory());

    for (const modelId of modelDirs) {
      const modelPath = path.join(configPath, modelId);
      const scenarioDirs = fs.readdirSync(modelPath).filter(d => fs.statSync(path.join(modelPath, d)).isDirectory());

      for (const scenario of scenarioDirs) {
        const scenarioPath = path.join(modelPath, scenario);
        const frameworkDirs = fs.readdirSync(scenarioPath).filter(d => fs.statSync(path.join(scenarioPath, d)).isDirectory());

        for (const framework of frameworkDirs) {
          const frameworkPath = path.join(scenarioPath, framework);
          const tempDirs = fs.readdirSync(frameworkPath).filter(d => fs.statSync(path.join(frameworkPath, d)).isDirectory());

          for (const tempDir of tempDirs) {
            // Parse safety prompt from dir name like "temp0.2-openapi-none"
            const safetyMatch = tempDir.match(/openapi-(\w+)$/);
            if (!safetyMatch) continue;
            const safetyPrompt = safetyMatch[1];

            const tempPath = path.join(frameworkPath, tempDir);
            const sampleDirs = fs.readdirSync(tempPath).filter(d => fs.statSync(path.join(tempPath, d)).isDirectory());

            for (const sampleDir of sampleDirs) {
              const sampleMatch = sampleDir.match(/sample(\d+)/);
              if (!sampleMatch) continue;
              const sampleNum = parseInt(sampleMatch[1]);

              const resultFile = path.join(tempPath, sampleDir, "test_results.json");
              if (!fs.existsSync(resultFile)) continue;

              try {
                const data = JSON.parse(fs.readFileSync(resultFile, "utf8"));
                const functionalPass = data.num_total_ft > 0 && data.num_passed_ft === data.num_total_ft ? 1 : 0;
                const codePath = path.join(tempPath, sampleDir, "code");

                const info = insertResult.run(
                  configId, scenario, framework, safetyPrompt, sampleNum,
                  functionalPass,
                  data.num_passed_ft || 0,
                  data.num_total_ft || 0,
                  data.num_ft_exceptions || 0,
                  data.num_total_st || 0,
                  data.num_st_exceptions || 0,
                  codePath
                );

                if (info.changes > 0) {
                  const resultId = info.lastInsertRowid;
                  totalImported++;

                  // Insert CWEs
                  const cwes = data.cwes || [];
                  for (const cwe of cwes) {
                    if (typeof cwe === "object" && cwe.num) {
                      insertCwe.run(resultId, cwe.num, cwe.desc || "");
                      totalCwes++;
                    } else if (typeof cwe === "string") {
                      // Handle string CWE format like "CWE-79"
                      const num = parseInt(cwe.replace(/\D/g, ""));
                      if (num) {
                        insertCwe.run(resultId, num, cwe);
                        totalCwes++;
                      }
                    }
                  }
                }
              } catch (e) {
                console.log(`  ⚠ Error reading ${resultFile}: ${e.message}`);
              }
            }
          }
        }
      }
    }

    const count = db.prepare("SELECT COUNT(*) as cnt FROM results WHERE config_id = ?").get(configId).cnt;
    console.log(`  ✓ ${configName}: ${count} results imported`);
  }
});

console.log("Importing results into database...\n");
importAll();

console.log(`\n✅ Done: ${totalImported} results, ${totalCwes} CWE occurrences imported (${skipped} configs skipped)`);

// Summary
const summary = db.prepare(`
  SELECT c.name, COUNT(r.id) as results,
    SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as func_pass,
    (SELECT COUNT(*) FROM result_cwes rc JOIN results r2 ON rc.result_id = r2.id WHERE r2.config_id = c.id) as cwes
  FROM configs c LEFT JOIN results r ON r.config_id = c.id
  GROUP BY c.id ORDER BY c.name
`).all();

console.log("\n  Config                    | Results | Func Pass | CWEs");
console.log("  " + "-".repeat(60));
for (const row of summary) {
  const name = row.name.padEnd(26);
  console.log(`  ${name} | ${String(row.results).padStart(7)} | ${String(row.func_pass).padStart(9)} | ${row.cwes}`);
}

db.close();
