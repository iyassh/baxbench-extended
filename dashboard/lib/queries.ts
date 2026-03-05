import { getDb } from "./db";
import type {
  Config,
  ConfigWithStats,
  Result,
  ResultWithCwes,
  CweDefinition,
  CweWithStats,
  CweOccurrence,
  Prompt,
  ScenarioSummary,
} from "./types";

// ── Configs ──────────────────────────────────────────────

export function getAllConfigs(): ConfigWithStats[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        c.id, c.name, c.model_id, c.thinking,
        COUNT(r.id) as total_results,
        SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
        SUM(CASE WHEN r.functional_pass = 1 AND NOT EXISTS (
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
    .all() as (Config & {
    total_results: number;
    functional_passes: number;
    secure_passes: number;
    total_cwes: number;
  })[];

  return rows.map((row) => ({
    ...row,
    thinking: Boolean(row.thinking),
    pass_at_1:
      row.total_results > 0 ? row.functional_passes / row.total_results : 0,
    sec_pass_at_1:
      row.total_results > 0 ? row.secure_passes / row.total_results : 0,
  }));
}

export function getConfigByName(name: string): ConfigWithStats | null {
  const all = getAllConfigs();
  return all.find((c) => c.name === name) ?? null;
}

// ── Results ──────────────────────────────────────────────

export function getResultsForConfig(configId: number): ResultWithCwes[] {
  const db = getDb();
  const results = db
    .prepare(
      "SELECT * FROM results WHERE config_id = ? ORDER BY scenario, framework, safety_prompt"
    )
    .all(configId) as Result[];

  return results.map((r) => ({
    ...r,
    functional_pass: Boolean(r.functional_pass),
    cwes: db
      .prepare("SELECT cwe_num, cwe_desc FROM result_cwes WHERE result_id = ?")
      .all(r.id) as CweOccurrence[],
  }));
}

export function getResultById(id: number): ResultWithCwes | null {
  const db = getDb();
  const result = db
    .prepare(
      `SELECT r.*, c.name as config_name
     FROM results r JOIN configs c ON r.config_id = c.id
     WHERE r.id = ?`
    )
    .get(id) as (Result & { config_name: string }) | undefined;
  if (!result) return null;

  const cwes = db
    .prepare("SELECT cwe_num, cwe_desc FROM result_cwes WHERE result_id = ?")
    .all(id) as CweOccurrence[];

  return {
    ...result,
    functional_pass: Boolean(result.functional_pass),
    cwes,
  };
}

// ── CWEs ─────────────────────────────────────────────────

export function getAllCwes(): CweDefinition[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM cwes ORDER BY num")
    .all() as CweDefinition[];
}

export function getCwesWithStats(): CweWithStats[] {
  const db = getDb();
  const cwes = getAllCwes();
  const configs = getAllConfigs();

  return cwes.map((cwe) => {
    const occurrences = db
      .prepare(`SELECT COUNT(*) as cnt FROM result_cwes WHERE cwe_num = ?`)
      .get(cwe.num) as { cnt: number };

    const totalResults = db
      .prepare("SELECT COUNT(*) as cnt FROM results")
      .get() as { cnt: number };

    const configRates = configs
      .filter((c) => c.total_results > 0)
      .map((c) => {
        const count = db
          .prepare(
            `SELECT COUNT(*) as cnt FROM result_cwes rc
             JOIN results r ON rc.result_id = r.id
             WHERE rc.cwe_num = ? AND r.config_id = ?`
          )
          .get(cwe.num, c.id) as { cnt: number };
        return { name: c.name, rate: count.cnt / c.total_results };
      });

    const sorted = configRates.sort((a, b) => a.rate - b.rate);

    return {
      ...cwe,
      is_extended: Boolean(cwe.is_extended),
      occurrence_count: occurrences.cnt,
      occurrence_rate:
        totalResults.cnt > 0 ? occurrences.cnt / totalResults.cnt : 0,
      worst_config:
        sorted.length > 0 ? sorted[sorted.length - 1].name : "N/A",
      best_config: sorted.length > 0 ? sorted[0].name : "N/A",
    };
  });
}

export function getCweDetail(num: number) {
  const db = getDb();
  const cwe = db
    .prepare("SELECT * FROM cwes WHERE num = ?")
    .get(num) as CweDefinition | undefined;
  if (!cwe) return null;

  const byConfig = db
    .prepare(
      `SELECT c.name, COUNT(*) as cnt
       FROM result_cwes rc
       JOIN results r ON rc.result_id = r.id
       JOIN configs c ON r.config_id = c.id
       WHERE rc.cwe_num = ?
       GROUP BY c.id
       ORDER BY cnt DESC`
    )
    .all(num) as { name: string; cnt: number }[];

  const byScenario = db
    .prepare(
      `SELECT r.scenario, COUNT(*) as cnt
       FROM result_cwes rc
       JOIN results r ON rc.result_id = r.id
       WHERE rc.cwe_num = ?
       GROUP BY r.scenario
       ORDER BY cnt DESC`
    )
    .all(num) as { scenario: string; cnt: number }[];

  const byFramework = db
    .prepare(
      `SELECT r.framework, COUNT(*) as cnt
       FROM result_cwes rc
       JOIN results r ON rc.result_id = r.id
       WHERE rc.cwe_num = ?
       GROUP BY r.framework
       ORDER BY cnt DESC`
    )
    .all(num) as { framework: string; cnt: number }[];

  return {
    cwe: { ...cwe, is_extended: Boolean(cwe.is_extended) },
    byConfig,
    byScenario,
    byFramework,
  };
}

// ── Scenarios ────────────────────────────────────────────

export function getAllScenarios(): ScenarioSummary[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        r.scenario,
        COUNT(*) as total_results,
        SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
        SUM(CASE WHEN r.functional_pass = 1 AND NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes,
        COUNT(DISTINCT rc.cwe_num) as unique_cwes
      FROM results r
      LEFT JOIN result_cwes rc ON rc.result_id = r.id
      GROUP BY r.scenario
      ORDER BY r.scenario`
    )
    .all() as ScenarioSummary[];
}

export function getScenarioResults(scenario: string): ResultWithCwes[] {
  const db = getDb();
  const results = db
    .prepare(
      `SELECT r.*, c.name as config_name
       FROM results r
       JOIN configs c ON r.config_id = c.id
       WHERE r.scenario = ?
       ORDER BY c.name, r.framework, r.safety_prompt`
    )
    .all(scenario) as (Result & { config_name: string })[];

  return results.map((r) => ({
    ...r,
    functional_pass: Boolean(r.functional_pass),
    cwes: db
      .prepare("SELECT cwe_num, cwe_desc FROM result_cwes WHERE result_id = ?")
      .all(r.id) as CweOccurrence[],
  }));
}

// ── Prompts ──────────────────────────────────────────────

export function getPromptsForScenario(scenario: string): Prompt[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM prompts WHERE scenario = ? ORDER BY framework, safety_prompt"
    )
    .all(scenario) as Prompt[];
}

// ── Comparisons ──────────────────────────────────────────

export function getThinkingComparison() {
  const configs = getAllConfigs();
  const pairs: { standard: ConfigWithStats; thinking: ConfigWithStats }[] = [];

  const standardConfigs = configs.filter(
    (c) => !c.thinking && c.total_results > 0
  );
  for (const std of standardConfigs) {
    const baseName = std.name.replace("-standard", "");
    const thk = configs.find(
      (c) => c.name === `${baseName}-thinking` && c.total_results > 0
    );
    if (thk) {
      pairs.push({ standard: std, thinking: thk });
    }
  }

  return pairs;
}

export function getSafetyPromptComparison() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        c.name as config_name,
        r.safety_prompt,
        COUNT(*) as total,
        SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
        SUM(CASE WHEN r.functional_pass = 1 AND NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes
      FROM results r
      JOIN configs c ON r.config_id = c.id
      GROUP BY c.name, r.safety_prompt
      ORDER BY c.name, r.safety_prompt`
    )
    .all() as {
    config_name: string;
    safety_prompt: string;
    total: number;
    functional_passes: number;
    secure_passes: number;
  }[];
}

export function getFrameworkComparison() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
        r.framework,
        c.name as config_name,
        COUNT(*) as total,
        SUM(CASE WHEN r.functional_pass = 1 THEN 1 ELSE 0 END) as functional_passes,
        SUM(CASE WHEN r.functional_pass = 1 AND NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes
      FROM results r
      JOIN configs c ON r.config_id = c.id
      GROUP BY r.framework, c.name
      ORDER BY r.framework, c.name`
    )
    .all() as {
    framework: string;
    config_name: string;
    total: number;
    functional_passes: number;
    secure_passes: number;
  }[];
}
