import map00 from './00-test.json';
import map01 from './01-feuertaufe.json';
import map02 from './02-zweite-front.json';
import map03 from './03-rastlos.json';
import map04 from './04-adrenalinrausch.json';
import map05 from './05-grufttitan.json';
import map06 from './06-sporenfront.json';
import map07 from './07-medic.json';
import map08 from './08-dimensionsbruch.json';
import map09 from './09-ueberleben.json';
import map10 from './10-flammenkoloss.json';
import map11 from './11-bombergeschwader.json';
import map12 from './12-gegenschlag.json';
import map13 from './13-brutbomben.json';
import map14 from './14-brandschneise.json';
import map15 from './15-leerenjaeger.json';
import map16 from './16-zeitzuender.json';
import map17 from './17-bierrettung.json';

import sources from '../coopDefenseMapSources.json';

const files: Record<string, unknown> = {
  '00-test.json': map00, '01-feuertaufe.json': map01,
  '02-zweite-front.json': map02, '03-rastlos.json': map03,
  '04-adrenalinrausch.json': map04, '05-grufttitan.json': map05,
  '06-sporenfront.json': map06, '07-medic.json': map07,
  '08-dimensionsbruch.json': map08, '09-ueberleben.json': map09,
  '10-flammenkoloss.json': map10, '11-bombergeschwader.json': map11,
  '12-gegenschlag.json': map12, '13-brutbomben.json': map13,
  '14-brandschneise.json': map14, '15-leerenjaeger.json': map15,
  '16-zeitzuender.json': map16, '17-bierrettung.json': map17,
};

/** File ownership and campaign ordering are shared with the local map editor. */
export const COOP_DEFENSE_MAP_REGISTRY = {
  defaultMapId: sources.defaultMapId,
  maps: sources.maps.map(source => files[source.file]),
};
