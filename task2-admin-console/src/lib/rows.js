/**
 * Applies a background refresh without moving anything: visible rows keep their
 * positions and take the new values. A re-sort is left for the user to ask for.
 */
export function mergeRefreshedPage(current, fresh) {
  if (!current) return fresh;
  const freshById = new Map(fresh.data.map((row) => [row.id, row]));
  const sameOrder =
    fresh.data.length === current.data.length &&
    fresh.data.every((row, index) => row.id === current.data[index].id);
  return {
    ...fresh,
    data: current.data.map((row) => freshById.get(row.id) ?? row),
    orderChanged: !sameOrder,
  };
}
