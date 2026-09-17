/** A resource that arrives after cancellation still belongs to this runner and must be closed. */
export async function acquireOwned(create, close, signal) {
  signal.throwIfAborted();
  const resource = await create();
  if (signal.aborted) {
    try { await close(resource); }
    finally { signal.throwIfAborted(); }
  }
  return resource;
}
