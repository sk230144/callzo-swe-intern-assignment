import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_INTERVAL_MS = 15_000;

const INITIAL_STATE = {
  data: null,
  isLoading: true,
  error: null,
  refreshFailed: false,
  updatedAt: null,
};

const keepNewest = (_current, fresh) => fresh;

/**
 * Loads data when `requestKey` changes, then refreshes it on a timer.
 *
 * A key change replaces the data and supersedes any request in flight. A timed
 * refresh goes through `merge`, and if it fails the existing data stays on screen.
 */
export function usePolledResource(load, requestKey, merge = keepNewest) {
  const [state, setState] = useState(INITIAL_STATE);
  const [reloadCount, setReloadCount] = useState(0);
  const latest = useRef({ load, merge });
  latest.current = { load, merge };

  useEffect(() => {
    const controller = new AbortController();
    let timer;

    const scheduleRefresh = () => {
      timer = setTimeout(() => fetchData(true), REFRESH_INTERVAL_MS);
    };

    const fetchData = async (isRefresh) => {
      if (isRefresh && document.hidden) {
        scheduleRefresh();
        return;
      }
      try {
        const fresh = await latest.current.load(controller.signal);
        setState((previous) => ({
          data: isRefresh ? latest.current.merge(previous.data, fresh) : fresh,
          isLoading: false,
          error: null,
          refreshFailed: false,
          updatedAt: Date.now(),
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((previous) =>
          isRefresh && previous.data
            ? { ...previous, refreshFailed: true }
            : { ...previous, data: null, isLoading: false, error },
        );
      }
      scheduleRefresh();
    };

    setState((previous) => ({ ...previous, isLoading: true, error: null }));
    fetchData(false);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [requestKey, reloadCount]);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);
  return { ...state, reload };
}
