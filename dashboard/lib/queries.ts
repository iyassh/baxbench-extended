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
  HeatmapCell,
  InsightData,
  RadarDataPoint,
  DeltaRow,
  CweTreemapItem,
  FamilyDistribution,
  SearchItem,
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
        SUM(CASE WHEN NOT EXISTS (
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
        SUM(CASE WHEN NOT EXISTS (
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
        SUM(CASE WHEN NOT EXISTS (
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

// ── Insights ────────────────────────────────────────────

export function getInsights(): InsightData[] {
  const configs = getAllConfigs().filter((c) => c.total_results > 0);
  const insights: InsightData[] = [];

  // Best and worst model by sec_pass@1
  const sorted = [...configs].sort(
    (a, b) => b.sec_pass_at_1 - a.sec_pass_at_1
  );
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  if (best) {
    insights.push({
      text: `${best.name} achieves the highest security pass rate at ${(best.sec_pass_at_1 * 100).toFixed(1)}%.`,
      type: "security",
      link: `/models?selected=${encodeURIComponent(best.name)}`,
    });
  }

  if (worst && worst.name !== best?.name) {
    insights.push({
      text: `${worst.name} has the lowest security pass rate at ${(worst.sec_pass_at_1 * 100).toFixed(1)}%.`,
      type: "security",
      link: `/models?selected=${encodeURIComponent(worst.name)}`,
    });
  }

  // Thinking vs standard comparison — per-pair analysis
  const thinkingDeltas = getThinkingDelta();

  if (thinkingDeltas.length > 0) {
    const deltas = thinkingDeltas.map((d) => ({
      family: d.config,
      delta_pp: d.delta * 100,
    }));
    const avgDelta =
      deltas.reduce((sum, d) => sum + d.delta_pp, 0) / deltas.length;
    const improved = deltas.filter((d) => d.delta_pp > 0.5);
    const worsened = deltas.filter((d) => d.delta_pp < -0.5);

    let text: string;
    if (improved.length > 0 && worsened.length === 0) {
      text = `Thinking mode improves security by ${avgDelta.toFixed(1)} pp on average across all ${deltas.length} model families.`;
    } else if (worsened.length > 0 && improved.length === 0) {
      text = `Thinking mode reduces security by ${Math.abs(avgDelta).toFixed(1)} pp on average across all ${deltas.length} model families.`;
    } else {
      const bestImproved = [...improved].sort(
        (a, b) => b.delta_pp - a.delta_pp
      )[0];
      const worstWorsened = [...worsened].sort(
        (a, b) => a.delta_pp - b.delta_pp
      )[0];
      const parts: string[] = [];
      if (bestImproved) {
        parts.push(
          `improves ${bestImproved.family} by +${bestImproved.delta_pp.toFixed(1)} pp`
        );
      }
      if (worstWorsened) {
        parts.push(
          `hurts ${worstWorsened.family} by ${worstWorsened.delta_pp.toFixed(1)} pp`
        );
      }
      text = `Thinking mode has mixed results (avg ${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(1)} pp): ${parts.join(" but ")}.`;
    }

    insights.push({
      text,
      type: "comparison",
    });
  }

  // Safety prompt impact: specific vs none
  const safetyData = getSafetyPromptComparison();
  const noneRows = safetyData.filter((r) => r.safety_prompt === "none");
  const specificRows = safetyData.filter(
    (r) => r.safety_prompt === "specific"
  );

  const noneTotal = noneRows.reduce((s, r) => s + r.secure_passes, 0);
  const noneCount = noneRows.reduce((s, r) => s + r.total, 0);
  const specificTotal = specificRows.reduce((s, r) => s + r.secure_passes, 0);
  const specificCount = specificRows.reduce((s, r) => s + r.total, 0);

  if (noneCount > 0 && specificCount > 0) {
    const noneRate = (noneTotal / noneCount) * 100;
    const specificRate = (specificTotal / specificCount) * 100;
    const impact = specificRate - noneRate;

    insights.push({
      text: `Specific safety prompts ${impact >= 0 ? "improve" : "decrease"} the security pass rate by ${Math.abs(impact).toFixed(1)} percentage points on average.`,
      type: "vulnerability",
    });
  }

  return insights;
}

// ── Heatmap ─────────────────────────────────────────────

export function getHeatmapData(): HeatmapCell[] {
  const db = getDb();
  return db
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
    .all() as HeatmapCell[];
}

// ── Radar ───────────────────────────────────────────────

export function getModelRadarData(configName: string): RadarDataPoint[] {
  const db = getDb();

  const config = getConfigByName(configName);
  if (!config || config.total_results === 0) return [];

  // Functional pass rate
  const funcRate = (config.pass_at_1 * 100);

  // Security pass rate
  const secRate = (config.sec_pass_at_1 * 100);

  // Per-framework security rates
  const frameworkData = db
    .prepare(
      `SELECT
        r.framework,
        COUNT(*) as total,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes
      FROM results r
      JOIN configs c ON r.config_id = c.id
      WHERE c.name = ?
      GROUP BY r.framework`
    )
    .all(configName) as {
    framework: string;
    total: number;
    secure_passes: number;
  }[];

  const frameworkRate = (fw: string): number => {
    const row = frameworkData.find((f) => f.framework === fw);
    if (!row || row.total === 0) return 0;
    return (row.secure_passes / row.total) * 100;
  };

  const flaskRate = frameworkRate("Python-Flask");
  const expressRate = frameworkRate("JavaScript-express");
  const fiberRate = frameworkRate("Go-Fiber");

  // Safety prompt responsiveness: delta between none and specific sec_pass@1
  const safetyData = db
    .prepare(
      `SELECT
        r.safety_prompt,
        COUNT(*) as total,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM result_cwes rc WHERE rc.result_id = r.id
        ) THEN 1 ELSE 0 END) as secure_passes
      FROM results r
      JOIN configs c ON r.config_id = c.id
      WHERE c.name = ?
      GROUP BY r.safety_prompt`
    )
    .all(configName) as {
    safety_prompt: string;
    total: number;
    secure_passes: number;
  }[];

  const noneRow = safetyData.find((s) => s.safety_prompt === "none");
  const specificRow = safetyData.find((s) => s.safety_prompt === "specific");
  const noneSecRate =
    noneRow && noneRow.total > 0
      ? (noneRow.secure_passes / noneRow.total) * 100
      : 0;
  const specificSecRate =
    specificRow && specificRow.total > 0
      ? (specificRow.secure_passes / specificRow.total) * 100
      : 0;
  // Responsiveness is how much the model improves with safety prompt, clamped to 0-100
  const responsiveness = Math.max(
    0,
    Math.min(100, specificSecRate - noneSecRate)
  );

  return [
    { axis: "Functional Pass Rate", value: funcRate },
    { axis: "Security Pass Rate", value: secRate },
    { axis: "Flask Security", value: flaskRate },
    { axis: "Express Security", value: expressRate },
    { axis: "Fiber Security", value: fiberRate },
    { axis: "Safety Prompt Responsiveness", value: responsiveness },
  ];
}

// ── CWE Treemap ─────────────────────────────────────────

export function getCweTreemapData(): CweTreemapItem[] {
  const db = getDb();
  return db
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
    .all() as CweTreemapItem[];
}

// ── Safety Prompt Delta ─────────────────────────────────

export function getSafetyPromptDelta(): DeltaRow[] {
  const safetyData = getSafetyPromptComparison();

  // Group by config_name
  const byConfig = new Map<
    string,
    { none: { secure: number; total: number }; specific: { secure: number; total: number } }
  >();

  for (const row of safetyData) {
    if (row.safety_prompt !== "none" && row.safety_prompt !== "specific")
      continue;
    if (!byConfig.has(row.config_name)) {
      byConfig.set(row.config_name, {
        none: { secure: 0, total: 0 },
        specific: { secure: 0, total: 0 },
      });
    }
    const entry = byConfig.get(row.config_name)!;
    if (row.safety_prompt === "none") {
      entry.none.secure += row.secure_passes;
      entry.none.total += row.total;
    } else {
      entry.specific.secure += row.secure_passes;
      entry.specific.total += row.total;
    }
  }

  const results: DeltaRow[] = [];
  for (const [config, data] of byConfig) {
    const baseline =
      data.none.total > 0 ? data.none.secure / data.none.total : 0;
    const comparison =
      data.specific.total > 0
        ? data.specific.secure / data.specific.total
        : 0;
    const delta = comparison - baseline;
    const delta_pct = baseline > 0 ? (delta / baseline) * 100 : 0;

    results.push({ config, baseline, comparison, delta, delta_pct });
  }

  return results.sort((a, b) => a.config.localeCompare(b.config));
}

// ── Thinking Delta ──────────────────────────────────────

export function getThinkingDelta(): DeltaRow[] {
  const configs = getAllConfigs().filter((c) => c.total_results > 0);
  const families = new Map<
    string,
    { standard?: ConfigWithStats; thinking?: ConfigWithStats }
  >();

  for (const c of configs) {
    const family = c.name.replace(/-standard$/, "").replace(/-thinking$/, "");
    if (!families.has(family)) {
      families.set(family, {});
    }
    const entry = families.get(family)!;
    if (c.thinking) {
      entry.thinking = c;
    } else {
      entry.standard = c;
    }
  }

  const results: DeltaRow[] = [];
  for (const [family, pair] of families) {
    if (!pair.standard || !pair.thinking) continue;

    const baseline = pair.standard.sec_pass_at_1;
    const comparison = pair.thinking.sec_pass_at_1;
    const delta = comparison - baseline;
    const delta_pct = baseline > 0 ? (delta / baseline) * 100 : 0;

    results.push({ config: family, baseline, comparison, delta, delta_pct });
  }

  return results.sort((a, b) => a.config.localeCompare(b.config));
}

// ── Distribution by Family ──────────────────────────────

export function getDistributionByFamily(): FamilyDistribution[] {
  const configs = getAllConfigs().filter((c) => c.total_results > 0);

  const familyMap = new Map<
    string,
    { configs: string[]; values: number[] }
  >();

  for (const c of configs) {
    // Extract family: haiku, sonnet, or opus
    let family: string | null = null;
    if (c.name.includes("haiku")) family = "haiku";
    else if (c.name.includes("sonnet")) family = "sonnet";
    else if (c.name.includes("opus")) family = "opus";

    if (!family) continue;

    if (!familyMap.has(family)) {
      familyMap.set(family, { configs: [], values: [] });
    }
    const entry = familyMap.get(family)!;
    entry.configs.push(c.name);
    entry.values.push(c.sec_pass_at_1);
  }

  const results: FamilyDistribution[] = [];

  for (const [family, data] of familyMap) {
    const sorted = [...data.values].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length === 0
        ? 0
        : sorted.length % 2 === 1
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;

    results.push({
      family,
      configs: data.configs,
      values: data.values,
      median,
      min,
      max,
    });
  }

  return results.sort((a, b) => a.family.localeCompare(b.family));
}

// ── Search Items ────────────────────────────────────────

export function getSearchItems(): SearchItem[] {
  const db = getDb();
  const items: SearchItem[] = [];

  // All configs as model items
  const configs = db
    .prepare("SELECT name FROM configs ORDER BY name")
    .all() as { name: string }[];

  for (const c of configs) {
    items.push({
      type: "model",
      label: c.name,
      href: `/models?selected=${encodeURIComponent(c.name)}`,
    });
  }

  // All unique scenarios
  const scenarios = db
    .prepare("SELECT DISTINCT scenario FROM results ORDER BY scenario")
    .all() as { scenario: string }[];

  for (const s of scenarios) {
    items.push({
      type: "scenario",
      label: s.scenario,
      href: `/models?scenario=${encodeURIComponent(s.scenario)}`,
    });
  }

  // All CWEs with occurrences
  const cwes = db
    .prepare(
      `SELECT cw.num, cw.name, COUNT(*) as cnt
       FROM result_cwes rc
       JOIN cwes cw ON cw.num = rc.cwe_num
       GROUP BY rc.cwe_num
       HAVING cnt > 0
       ORDER BY cw.num`
    )
    .all() as { num: number; name: string; cnt: number }[];

  for (const c of cwes) {
    items.push({
      type: "cwe",
      label: `CWE-${c.num}: ${c.name}`,
      href: `/vulnerabilities?cwe=${c.num}`,
      subtitle: `${c.cnt} occurrence${c.cnt !== 1 ? "s" : ""}`,
    });
  }

  return items;
}
