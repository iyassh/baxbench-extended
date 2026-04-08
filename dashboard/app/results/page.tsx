import { loadConfigs, loadResultsByConfig, loadZapValidation } from "@/lib/data";
import { ResultsClient } from "./results-client";
import { ZapValidation } from "@/components/zap-validation";
import { PageTransition } from "@/components/page-transition";

export default function ResultsPage() {
  const configs = loadConfigs();
  const resultsByConfig = loadResultsByConfig();
  const zapData = loadZapValidation();

  return (
    <PageTransition>
      <div className="space-y-12">
        <ResultsClient
          configs={configs}
          resultsByConfig={resultsByConfig}
        />

        {/* ZAP Validation Section */}
        <section>
          <div className="mb-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
              ZAP Active Scan Validation
            </h2>
            <p className="text-zinc-500 text-sm mt-1">
              50 apps scanned with OWASP ZAP to validate CodeStrike findings
            </p>
          </div>
          <ZapValidation data={zapData} />
        </section>
      </div>
    </PageTransition>
  );
}
