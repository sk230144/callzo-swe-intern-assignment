import { useCallback, useEffect, useRef, useState } from 'react';
import { parseUrlState, serializeUrlState } from '../lib/urlState.js';

export function useUrlState() {
  const [state, setState] = useState(() => parseUrlState(window.location.search));
  const latest = useRef(state);

  useEffect(() => {
    const syncFromAddressBar = () => {
      latest.current = parseUrlState(window.location.search);
      setState(latest.current);
    };
    window.addEventListener('popstate', syncFromAddressBar);
    return () => window.removeEventListener('popstate', syncFromAddressBar);
  }, []);

  const update = useCallback((patch, { replace = false } = {}) => {
    latest.current = { ...latest.current, ...patch };
    const search = serializeUrlState(latest.current);
    const url = search ? `?${search}` : window.location.pathname;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    setState(latest.current);
  }, []);

  return [state, update];
}
