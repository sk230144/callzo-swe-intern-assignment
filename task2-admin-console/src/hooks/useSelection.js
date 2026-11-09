import { useCallback, useState } from 'react';

/** Selected rows by id, so a selection survives paging, filtering and refreshes. */
export function useSelection() {
  const [selected, setSelected] = useState(() => new Map());

  const setRows = useCallback((rows, isSelected) => {
    setSelected((current) => {
      const next = new Map(current);
      for (const row of rows) {
        if (isSelected) next.set(row.id, row);
        else next.delete(row.id);
      }
      return next;
    });
  }, []);

  const refreshValues = useCallback((rows) => {
    setSelected((current) => {
      const visibleSelected = rows.filter((row) => current.has(row.id));
      if (!visibleSelected.length) return current;
      const next = new Map(current);
      for (const row of visibleSelected) next.set(row.id, row);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Map()), []);

  return { selected, setRows, refreshValues, clear };
}
