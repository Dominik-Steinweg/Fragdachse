/** Debug access lasts until the page is reloaded and never changes saved campaign progress. */
let testMapUnlocked = false;
let unreleasedMapsUnlocked = false;

export function areCoopDefenseUnreleasedMapsUnlocked(): boolean {
  return unreleasedMapsUnlocked;
}

export function unlockCoopDefenseUnreleasedMaps(): void {
  unreleasedMapsUnlocked = true;
}

export function isCoopDefenseTestMapUnlocked(): boolean {
  return testMapUnlocked;
}

export function unlockCoopDefenseTestMap(): void {
  testMapUnlocked = true;
}
