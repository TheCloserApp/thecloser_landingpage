// Serializes work in one warm instance. Not a distributed lock: see README.
const pending = new Map();
export async function serial(key, operation) {
  const previous = pending.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  pending.set(key, current);
  try { return await current; }
  finally { if (pending.get(key) === current) pending.delete(key); }
}
