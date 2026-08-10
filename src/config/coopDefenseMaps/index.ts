import map00 from './00-test.json';
import map01 from './01-feuertaufe.json';
import map02 from './02-zweite-front.json';
import map03 from './03-rastlos.json';
import map04 from './04-adrenalinrausch.json';
import map05 from './05-grufttitan.json';
import map06 from './06-sporenfront.json';
import map07 from './07-medic.json';
import map08 from './08-dimensionsbruch.json';
import map09 from './09-faulnisbrut.json';
import map10 from './10-flammenkoloss.json';
import map11 from './11-bombergeschwader.json';
import map12 from './12-gegenschlag.json';
import map13 from './13-brutbomben.json';
import map14 from './14-brandschneise.json';
import map15 from './15-leerenjaeger.json';
import map16 from './16-zeitzuender.json';

/** Statische Kampagnenregistry; die Reihenfolge ist fachlich relevant. */
export const COOP_DEFENSE_MAP_REGISTRY = {
  defaultMapId: '1',
  maps: [
    map00,
    map01,
    map02,
    map03,
    map04,
    map05,
    map06,
    map07,
    map08,
    map09,
    map10,
    map11,
    map12,
    map13,
    map14,
    map15,
    map16,
  ],
} as const;
