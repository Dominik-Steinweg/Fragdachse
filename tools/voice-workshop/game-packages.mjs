import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateVoiceBundle } from '../../src/voice/VoicePackage.ts';

/** Write only the validated runtime bundle; the next Vite build discovers it. */
export async function installGamePackage(directory, input) {
  const bundle = await validateVoiceBundle(input);
  if (bundle.packages.length !== 1) throw new Error('Bitte genau eine Stimme ins Spiel übernehmen.');
  const pack = bundle.packages[0];
  await mkdir(directory, { recursive: true });
  const file = `${pack.manifest.voiceId}.fdvoice`;
  // The shared validator restricts voiceId to a filename-safe identifier.
  const temporary = path.join(directory, `${file}.${randomUUID()}.pending`);
  await writeFile(temporary, JSON.stringify(bundle), { flag: 'wx' });
  await rename(temporary, path.join(directory, file));
  return { checksum: pack.checksum, version: pack.manifest.version, clips: pack.manifest.clips.length, file };
}
