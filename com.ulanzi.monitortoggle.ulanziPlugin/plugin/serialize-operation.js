// Keep display changes and their audio snapshots in the same operation.
export function serializeOperation(operation) {
  let pending = Promise.resolve();
  return (...args) => {
    const result = pending.then(() => operation(...args));
    pending = result.catch(() => {});
    return result;
  };
}
