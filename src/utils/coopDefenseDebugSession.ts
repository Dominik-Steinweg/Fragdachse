/** Debug access lasts until the page is reloaded and never changes saved campaign progress. */
let testMapUnlocked = false;

export function isCoopDefenseTestMapUnlocked(): boolean {
  return testMapUnlocked;
}

export function unlockCoopDefenseTestMap(): void {
  testMapUnlocked = true;
}
