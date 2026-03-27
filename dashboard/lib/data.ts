import fs from "fs";
import path from "path";

const cache = new Map<string, unknown>();

function loadJSON<T>(name: string): T {
  if (cache.has(name)) return cache.get(name) as T;
  const filePath = path.join(process.cwd(), "data", `${name}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  cache.set(name, data);
  return data;
}

export function loadConfigs() {
  return loadJSON<import("./types").ConfigWithStats[]>("configs");
}

export function loadResultsByConfig() {
  return loadJSON<Record<string, import("./types").ResultWithCwes[]>>("results-by-config");
}

export function loadCwesWithStats() {
  return loadJSON<import("./types").CweWithStats[]>("cwes-with-stats");
}

export function loadHeatmap() {
  return loadJSON<import("./types").HeatmapCell[]>("heatmap");
}

export function loadSafetyComparison() {
  return loadJSON<{
    config_name: string;
    safety_prompt: string;
    total: number;
    functional_passes: number;
    secure_passes: number;
  }[]>("safety-comparison");
}

export function loadFrameworkComparison() {
  return loadJSON<{
    framework: string;
    config_name: string;
    total: number;
    functional_passes: number;
    secure_passes: number;
  }[]>("framework-comparison");
}

export function loadRadarByConfig() {
  return loadJSON<Record<string, import("./types").RadarDataPoint[]>>("radar-by-config");
}

export function loadCweTreemap() {
  return loadJSON<import("./types").CweTreemapItem[]>("cwe-treemap");
}

export function loadSearchItems() {
  return loadJSON<import("./types").SearchItem[]>("search-items");
}
