"use client";

import { useState, useEffect, useCallback } from "react";

const SERVER_URL = "http://localhost:3001";

interface ServerStatus {
  isAvailable: boolean;
  hasDocker: boolean;
  isLoading: boolean;
}

let cachedStatus: ServerStatus | null = null;

export function usePreviewServer(): ServerStatus & {
  fetchFromServer: <T>(path: string, options?: RequestInit) => Promise<T>;
} {
  const [status, setStatus] = useState<ServerStatus>(
    cachedStatus ?? { isAvailable: false, hasDocker: false, isLoading: true }
  );

  useEffect(() => {
    if (cachedStatus) {
      setStatus(cachedStatus);
      return;
    }
    fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.json())
      .then((data) => {
        const s = { isAvailable: true, hasDocker: data.docker, isLoading: false };
        cachedStatus = s;
        setStatus(s);
      })
      .catch(() => {
        const s = { isAvailable: false, hasDocker: false, isLoading: false };
        cachedStatus = s;
        setStatus(s);
      });
  }, []);

  const fetchFromServer = useCallback(
    async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const res = await fetch(`${SERVER_URL}${path}`, options);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      return res.json();
    },
    []
  );

  return { ...status, fetchFromServer };
}
