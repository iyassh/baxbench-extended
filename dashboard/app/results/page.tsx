import { loadConfigs, loadResultsByConfig } from "@/lib/data";
import { ResultsClient } from "./results-client";

export default function ResultsPage() {
  const configs = loadConfigs();
  const resultsByConfig = loadResultsByConfig();

  return (
    <ResultsClient
      configs={configs}
      resultsByConfig={resultsByConfig}
    />
  );
}
