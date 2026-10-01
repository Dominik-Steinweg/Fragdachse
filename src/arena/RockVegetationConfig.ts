import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';

/** Shared destruction/overhang mask for rock colonies. */
export const ROCK_VEGETATION_MASK_TEXTURE_KEY = 'rock_vegetation_mask';
const ROCK_VEGETATION_MASK_ASSET = './assets/sprites/rocks47blob_vegmask.png';

/**
 * Kantenlaenge eines Maskenframes. Der Frame liegt zentriert ueber seiner Zelle; die Haelfte der
 * Differenz ist damit die maximale Reichweite der Maske nach aussen und zugleich der Rand, den ein
 * Chunk-Neubau bei der Maskensammlung mitnehmen muss.
 */
export const ROCK_VEGETATION_MASK_FRAME_SIZE = CELL_SIZE * 2;
export const ROCK_VEGETATION_MASK_MARGIN_PX = (ROCK_VEGETATION_MASK_FRAME_SIZE - CELL_SIZE) / 2;
/**
 * Abstand, ab dem die Maske ausserhalb des Felsens vollstaendig offen ist – Spiegelbild von
 * `MASK_REACH_PX` im Generatorskript. Was weiter hinausragt, schneidet die Stanzform wieder weg;
 * der Ueberhang der Matten muss deshalb darunter bleiben.
 */
export const ROCK_VEGETATION_MASK_REACH_PX = 15;

export function preloadRockVegetationMask(loader: Phaser.Loader.LoaderPlugin): void {
  loader.spritesheet(ROCK_VEGETATION_MASK_TEXTURE_KEY, ROCK_VEGETATION_MASK_ASSET, {
    frameWidth: ROCK_VEGETATION_MASK_FRAME_SIZE,
    frameHeight: ROCK_VEGETATION_MASK_FRAME_SIZE,
  });
}
