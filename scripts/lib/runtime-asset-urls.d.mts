export const RUNTIME_COLOURS_MANIFEST: string;
export function runtimeAssetUrls(options?: {
  readonly manifest?: string;
  readonly publicRoot?: string;
  /** Keys whose published manifest entry no longer matches its file and was bypassed. */
  readonly onStale?: (keys: readonly string[]) => void;
}): Record<string, string>;
