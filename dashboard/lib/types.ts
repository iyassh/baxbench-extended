export interface Config {
  id: number;
  name: string;
  model_id: string;
  thinking: boolean;
}

export interface ConfigWithStats extends Config {
  total_results: number;
  functional_passes: number;
  secure_passes: number;
  truly_secure_passes: number;
  total_cwes: number;
  pass_at_1: number;
  sec_pass_at_1: number;
  true_sec_pass_at_1: number;
  secure_by_crash: number;
}

export interface Result {
  id: number;
  config_id: number;
  scenario: string;
  framework: string;
  safety_prompt: string;
  sample: number;
  functional_pass: boolean;
  num_passed_ft: number;
  num_total_ft: number;
  num_ft_exceptions: number;
  num_total_st: number;
  num_st_exceptions: number;
  code_path: string | null;
  gen_log_path: string | null;
  test_log_path: string | null;
}

export interface ResultWithCwes extends Result {
  cwes: CweOccurrence[];
  config_name?: string;
}

export interface CweOccurrence {
  cwe_num: number;
  cwe_desc: string;
}

export interface CweDefinition {
  num: number;
  name: string;
  description: string;
  is_extended: boolean;
}

export interface CweWithStats extends CweDefinition {
  occurrence_count: number;
  occurrence_rate: number;
  worst_config: string;
  best_config: string;
}

export interface Prompt {
  id: number;
  scenario: string;
  framework: string;
  safety_prompt: string;
  spec_type: string;
  prompt_text: string;
}

export interface ScenarioSummary {
  scenario: string;
  total_results: number;
  functional_passes: number;
  secure_passes: number;
  unique_cwes: number;
}

export interface HeatmapCell {
  model: string;
  scenario: string;
  cwe_count: number;
  total_tests: number;
}

export interface InsightData {
  text: string;
  type: "security" | "comparison" | "vulnerability";
  link?: string;
}

export interface RadarDataPoint {
  axis: string;
  value: number;
}

export interface DeltaRow {
  config: string;
  baseline: number;
  comparison: number;
  delta: number;
  delta_pct: number;
  baseline_true: number;
  comparison_true: number;
  delta_true: number;
  delta_pct_true: number;
}

export interface CweTreemapItem {
  name: string;
  cwe_num: number;
  occurrences: number;
  affected_models: number;
}

export interface FamilyDistribution {
  family: string;
  configs: string[];
  values: number[];
  median: number;
  min: number;
  max: number;
}

export interface SearchItem {
  type: "model" | "cwe" | "scenario";
  label: string;
  href: string;
  subtitle?: string;
}
