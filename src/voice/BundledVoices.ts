import { validateVoiceBundle, type VoicePackage } from './VoicePackage';

type BundleSource = () => Promise<string>;
const bundledSources = import.meta.glob<string>('./bundled/*.fdvoice', { query: '?raw', import: 'default' });

/** Build-owned content works without IndexedDB or access to the local workshop. */
export async function loadBundledVoices(sources: Record<string, BundleSource> = bundledSources): Promise<VoicePackage[]> {
  const packages: VoicePackage[] = [];
  for (const load of Object.values(sources)) {
    try {
      const bundle = await validateVoiceBundle(JSON.parse(await load()));
      packages.push(...bundle.packages);
    } catch { /* A damaged optional voice must not prevent the game from starting. */ }
  }
  return packages;
}
