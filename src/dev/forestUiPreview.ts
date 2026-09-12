// A separate Vite development entry, never imported from the production entry.
// Install an ephemeral Storage implementation BEFORE importing any game modules.
// Options and locale APIs therefore exercise their real paths without touching a save.
if (import.meta.env.DEV) {
  const memoryStorage = (): Storage => {
    const values = new Map<string, string>();
    return { get length() { return values.size; }, clear: () => values.clear(),
      getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
      removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, String(value)); } };
  };
  Object.defineProperty(window, 'localStorage', { value: memoryStorage() });
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage() });
  void import('./forestUiPreviewScene');
}
export {};
