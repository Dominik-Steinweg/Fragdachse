import manifest from '../../../public/assets/environment/woodland/ecology/rock-colonies.json';
import type { RockVegetationPlacement } from '../RockVegetationField';

export const ROCK_ECOLOGY_ATLAS = { ...manifest.atlas, key: 'woodland-rock-colonies' };
export const ROCK_CONTACT_ATLAS = { ...manifest.contactAtlas, key: 'woodland-rock-contact' };
export const ROCK_ECOLOGY_ATLASES = [ROCK_ECOLOGY_ATLAS,ROCK_CONTACT_ATLAS];
export const ROCK_CONTACT_ASSETS = new Map(manifest.contacts.map(a=>[a.name,a]));
export const ROCK_ECOLOGY_ASSETS = manifest.assets.map(asset => ({ ...asset, key: ROCK_ECOLOGY_ATLAS.key }));
