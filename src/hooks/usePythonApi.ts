/**
 * usePythonApi — React hook for calling the Python backend.
 *
 * Wraps pythonApi calls with loading / error state so you don't have to
 * write try/catch + useState boilerplate in every component.
 *
 * Usage:
 *   const { call, data, loading, error } = usePythonApi<RepoMeta>();
 *
 *   useEffect(() => {
 *     call(() => pythonApi.github.fetchRepo({ owner: "octocat", repo: "hello-world" }));
 *   }, []);
 *
 * Or call it imperatively (e.g. on button click):
 *   <button onClick={() => call(() => pythonApi.ai.chat({ messages }))}>Ask AI</button>
 */

import { useCallback, useState } from "react";
import { pythonApi, PythonApiError } from "@/lib/python-api";

interface UsePythonApiReturn<T> {
  /** Trigger the API call. Pass a function that returns a pythonApi promise. */
  call: (fn: () => Promise<T>) => Promise<T | undefined>;
  /** The last successful response data. */
  data: T | undefined;
  /** True while the request is in-flight. */
  loading: boolean;
  /** The last error message, or null if the last call succeeded. */
  error: string | null;
  /** Manually clear error/data state. */
  reset: () => void;
}

export function usePythonApi<T>(): UsePythonApiReturn<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      setData(result);
      return result;
    } catch (err) {
      const msg =
        err instanceof PythonApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "An unexpected error occurred";
      setError(msg);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(undefined);
    setError(null);
  }, []);

  return { call, data, loading, error, reset };
}

// Re-export pythonApi so components only need one import
export { pythonApi };
export type { PythonApiError };
