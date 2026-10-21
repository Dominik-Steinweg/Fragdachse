import clearing from './clearing.json';
import pondland from './pondland.json';
import rockbasin from './rockbasin.json';
import oldwood from './oldwood.json';
import riverbend from './riverbend.json';

/** Authored Dawn-Arenen; Reihenfolge und Inhalt fliessen in den Dawn-Content-Hash ein. */
export const DAWN_ARENA_TEMPLATE_SOURCES: readonly unknown[] = [clearing, pondland, rockbasin, oldwood, riverbend];
