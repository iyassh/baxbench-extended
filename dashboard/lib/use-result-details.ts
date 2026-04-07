"use client";

import { useState, useEffect } from "react";

interface CodeFile {
  name: string;
  content: string;
  language: string;
}

interface TestLog {
  name: string;
  type: "functional" | "security";
  content: string;
  passed: boolean;
}

export interface ResultDetails {
  prompt: string | null;
  code: CodeFile[];
  logs: { buildLog: string; testLogs: TestLog[] };
}

const cache = new Map<string, Record<string, ResultDetails>>();

export function useResultDetails(
  configName: string,
  resultId: number
): { data: ResultDetails | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<ResultDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check cache first
    if (cache.has(configName)) {
      const details = cache.get(configName)!;
      setData(details[String(resultId)] ?? null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/details/${encodeURIComponent(configName)}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load details: ${res.status}`);
        return res.json();
      })
      .then((allDetails: Record<string, ResultDetails>) => {
        cache.set(configName, allDetails);
        setData(allDetails[String(resultId)] ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [configName, resultId]);

  return { data, loading, error };
}
