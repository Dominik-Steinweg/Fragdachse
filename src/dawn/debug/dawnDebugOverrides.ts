// Debug menu toggle for this session, read only by the host before it composes the next round.
// It never changes an active plan and is never persisted.
let forcedPortalGenerator = false;
export function setDawnPortalGeneratorForced(value: boolean): void { forcedPortalGenerator = value; }
export function isDawnPortalGeneratorForced(): boolean { return forcedPortalGenerator; }
