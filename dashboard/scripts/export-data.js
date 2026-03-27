#!/usr/bin/env node
/**
 * Export all dashboard data from SQLite to static JSON files.
 * Run this whenever the database changes:
 *   node scripts/export-data.js
 */
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "baxbench.db");
const OUT_DIR = path.join(__dirname, "..", "data");

if (!fs.existsSync(DB_PATH)) {
  console.error("Database not found at", DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
db.pragma("journal_mode = WAL");

// Ensure output directory exists
fs.mkdirSync(OUT_DIR, { recursive: true });

function write(name, data) {
  const file = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 0));
  console.log(`  ✓ ${name}.json (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

console.log("Exporting dashboard data from SQLite...\n");

// ── Configs ──────────────────────────────────────────────
const configs = db
  .prepare(
    `SELECT
      c.id, c.name, c.model_id, c.thinking,
      COUNT(r.id) as total_results,
      SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
      SUM(CASE WHEN NOT EXISTS (
        SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
      ) THEN 1 ELSE 0 END) as secure_passes,
      (SELECT COUNT(*) FROM result_cwes rc
       JOIN results r2 ON rc.result_id = r2.id
       WHERE r2.config_id = c.id) as total_cwes
    FROM configs c
    LEFT JOIN results r ON r.config_id = c.id
    GROUP BY c.id
    ORDER BY c.name`
  )
  .all()
  .map((row) => ({
    ...row,
    thinking: Boolean(row.thinking),
    pass_at_1: row.total_results > 0 ? row.functional_passes / row.total_results : 0,
    sec_pass_at_1: row.total_results > 0 ? row.secure_passes / row.total_results : 0,
  }));

write("configs", configs);

// ── Results per config ───────────────────────────────────
const resultsMap = {};
for (const c of configs) {
  if (c.total_results === 0) continue;
  const results = db
    .prepare("SELECT * FROM results WHERE config_id = ? ORDER BY scenario, framework, safety_prompt")
    .all(c.id);

  resultsMap[c.name] = results.map((r) => ({
    ...r,
    functional_pass: Boolean(r.functional_pass),
    cwes: db
      .prepare("SELECT cwe_num, cwe_desc FROM result_cwes WHERE result_id = ?")
      .all(r.id),
  }));
}
write("results-by-config", resultsMap);

// ── CWEs ─────────────────────────────────────────────────
const cwes = db.prepare("SELECT * FROM cwes ORDER BY num").all();
write("cwes", cwes);

// ── CWEs with stats ──────────────────────────────────────
const totalResultCount = db.prepare("SELECT COUNT(*) as cnt FROM results").get().cnt;

const cwesWithStats = cwes.map((cwe) => {
  const occurrences = db
    .prepare("SELECT COUNT(*) as cnt FROM result_cwes WHERE cwe_num = ?")
    .get(cwe.num).cnt;

  const configRates = configs
    .filter((c) => c.total_results > 0)
    .map((c) => {
      const count = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM result_cwes rc
           JOIN results r ON rc.result_id = r.id
           WHERE rc.cwe_num = ? AND r.config_id = ?`
        )
        .get(cwe.num, c.id).cnt;
      return { name: c.name, rate: count / c.total_results };
    })
    .sort((a, b) => a.rate - b.rate);

  return {
    ...cwe,
    is_extended: Boolean(cwe.is_extended),
    occurrence_count: occurrences,
    occurrence_rate: totalResultCount > 0 ? occurrences / totalResultCount : 0,
    worst_config: configRates.length > 0 ? configRates[configRates.length - 1].name : "N/A",
    best_config: configRates.length > 0 ? configRates[0].name : "N/A",
  };
});
write("cwes-with-stats", cwesWithStats);

// ── Heatmap ──────────────────────────────────────────────
const heatmap = db
  .prepare(
    `SELECT
      c.name as model,
      r.scenario,
      COUNT(DISTINCT rc.id) as cwe_count,
      COUNT(DISTINCT r.id) as total_tests
    FROM configs c
    JOIN results r ON r.config_id = c.id
    LEFT JOIN result_cwes rc ON rc.result_id = r.id
    GROUP BY c.name, r.scenario
    ORDER BY c.name, r.scenario`
  )
  .all();
write("heatmap", heatmap);

// ── Safety Prompt Comparison ─────────────────────────────
const safetyComparison = db
  .prepare(
    `SELECT
      c.name as config_name,
      r.safety_prompt,
      COUNT(*) as total,
      SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
      SUM(CASE WHEN NOT EXISTS (
        SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
      ) THEN 1 ELSE 0 END) as secure_passes
    FROM results r
    JOIN configs c ON r.config_id = c.id
    GROUP BY c.name, r.safety_prompt
    ORDER BY c.name, r.safety_prompt`
  )
  .all();
write("safety-comparison", safetyComparison);

// ── Framework Comparison ─────────────────────────────────
const frameworkComparison = db
  .prepare(
    `SELECT
      r.framework,
      c.name as config_name,
      COUNT(*) as total,
      SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
      SUM(CASE WHEN NOT EXISTS (
        SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
      ) THEN 1 ELSE 0 END) as secure_passes
    FROM results r
    JOIN configs c ON r.config_id = c.id
    GROUP BY r.framework, c.name
    ORDER BY r.framework, c.name`
  )
  .all();
write("framework-comparison", frameworkComparison);

// ── Radar data per config ────────────────────────────────
const radarMap = {};
for (const c of configs) {
  if (c.total_results === 0) continue;

  const funcRate = c.pass_at_1 * 100;
  const secRate = c.sec_pass_at_1 * 100;

  const frameworkData = db
    .prepare(
      `SELECT
        r.framework,
        COUNT(*) as total,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes
      FROM results r
      JOIN configs c2 ON r.config_id = c2.id
      WHERE c2.name = ?
      GROUP BY r.framework`
    )
    .all(c.name);

  const fwRate = (fw) => {
    const row = frameworkData.find((f) => f.framework === fw);
    if (!row || row.total === 0) return 0;
    return (row.secure_passes / row.total) * 100;
  };

  const safetyData = db
    .prepare(
      `SELECT
        r.safety_prompt,
        COUNT(*) as total,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes
      FROM results r
      JOIN configs c2 ON r.config_id = c2.id
      WHERE c2.name = ?
      GROUP BY r.safety_prompt`
    )
    .all(c.name);

  const noneRow = safetyData.find((s) => s.safety_prompt === "none");
  const specificRow = safetyData.find((s) => s.safety_prompt === "specific");
  const noneSecRate = noneRow && noneRow.total > 0 ? (noneRow.secure_passes / noneRow.total) * 100 : 0;
  const specificSecRate = specificRow && specificRow.total > 0 ? (specificRow.secure_passes / specificRow.total) * 100 : 0;
  const responsiveness = Math.max(0, Math.min(100, specificSecRate - noneSecRate));

  radarMap[c.name] = [
    { axis: "Functional Pass Rate", value: funcRate },
    { axis: "Security Pass Rate", value: secRate },
    { axis: "Flask Security", value: fwRate("Python-Flask") },
    { axis: "Express Security", value: fwRate("JavaScript-express") },
    { axis: "Fiber Security", value: fwRate("Go-Fiber") },
    { axis: "Safety Prompt Responsiveness", value: responsiveness },
  ];
}
write("radar-by-config", radarMap);

// ── CWE Treemap ──────────────────────────────────────────
const treemap = db
  .prepare(
    `SELECT
      cw.name,
      rc.cwe_num,
      COUNT(*) as occurrences,
      COUNT(DISTINCT r.config_id) as affected_models
    FROM result_cwes rc
    JOIN cwes cw ON cw.num = rc.cwe_num
    JOIN results r ON r.id = rc.result_id
    GROUP BY rc.cwe_num
    HAVING occurrences > 0
    ORDER BY occurrences DESC`
  )
  .all();
write("cwe-treemap", treemap);

// ── Scenarios ────────────────────────────────────────────
const scenarios = db
  .prepare(
    `SELECT
      r.scenario,
      COUNT(DISTINCT r.id) as total_results,
      COUNT(DISTINCT CASE WHEN r.functional_pass = 1 THEN r.id END) as functional_passes,
      COUNT(DISTINCT CASE WHEN NOT EXISTS (
        SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
      ) THEN r.id END) as secure_passes,
      COUNT(DISTINCT rc.cwe_num) as unique_cwes
    FROM results r
    LEFT JOIN result_cwes rc ON rc.result_id = r.id
    GROUP BY r.scenario
    ORDER BY r.scenario`
  )
  .all();
write("scenarios", scenarios);

// ── Search Items ─────────────────────────────────────────
const searchItems = [];

for (const c of configs) {
  searchItems.push({
    type: "model",
    label: c.name,
    href: `/models?selected=${encodeURIComponent(c.name)}`,
  });
}

const scenarioNames = db.prepare("SELECT DISTINCT scenario FROM results ORDER BY scenario").all();
for (const s of scenarioNames) {
  searchItems.push({
    type: "scenario",
    label: s.scenario,
    href: `/models?scenario=${encodeURIComponent(s.scenario)}`,
  });
}

const cweSearch = db
  .prepare(
    `SELECT cw.num, cw.name, COUNT(*) as cnt
     FROM result_cwes rc
     JOIN cwes cw ON cw.num = rc.cwe_num
     GROUP BY rc.cwe_num
     HAVING cnt > 0
     ORDER BY cw.num`
  )
  .all();
for (const c of cweSearch) {
  searchItems.push({
    type: "cwe",
    label: `CWE-${c.num}: ${c.name}`,
    href: `/vulnerabilities?cwe=${c.num}`,
    subtitle: `${c.cnt} occurrence${c.cnt !== 1 ? "s" : ""}`,
  });
}
write("search-items", searchItems);

db.close();
console.log("\n✅ All data exported to dashboard/data/");
