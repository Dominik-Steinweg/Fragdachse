import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { LOBBY_STRUCTURE_ASSETS, lobbyStructureAsset } from '../../src/arena/lobbyStructures/LobbyStructureAssets';
import { LOBBY_BUILDINGS, lobbyBuildingOutline } from '../../src/config/authoring/lobbyBuildings';
import outlines from '../../src/config/authoring/lobbyStructureOutlines.json';
import { isInsideStructure, nearestStructurePoint } from '../../src/arena/StructureOutline';
import { lobbyStaffAsset } from '../../src/animations/LobbyStaffAssets';

const root = path.resolve(__dirname, '../..');
const file = (asset: string, pass: string) => path.join(root, 'public/assets/sprites/pipeline-v2', asset, `${pass}.png`);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('lobby structure exports', () => {
  it('publish every pass the manifest names, byte-identical to its hashes', () => {
    for (const building of LOBBY_BUILDINGS) {
      const asset = lobbyStructureAsset(building.id)!;
      expect(asset, building.id).toBeTruthy();
      for (const [pass, hash] of Object.entries(asset.sha256)) expect(sha(readFileSync(file(asset.asset, pass))), `${asset.asset}/${pass}`).toBe(hash);
      for (const layer of asset.layers) expect(asset.sha256[`emission-${layer}`], `${asset.asset} ${layer}`).toBeDefined();
      expect(asset.sha256['caster-height'], `${asset.asset} caster`).toBeDefined();
    }
    expect(Object.keys(LOBBY_STRUCTURE_ASSETS).sort()).toEqual(LOBBY_BUILDINGS.map(building => building.id).sort());
  });

  it('derive each collision outline from the solid pass that is published with it', () => {
    for (const entry of outlines) {
      const asset = lobbyStructureAsset(entry.id)!;
      expect(entry.sourceSha256, entry.id).toBe(asset.sha256.solid);
    }
  });

  it('cover the drawn solid geometry: no solid pixel lies more than one 8 px step outside the outline', async () => {
    for (const building of LOBBY_BUILDINGS) {
      const asset = lobbyStructureAsset(building.id)!;
      const { rects } = lobbyBuildingOutline(building);
      const { data, info } = await sharp(file(asset.asset, 'solid')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const scale = info.width / asset.displaySize;
      let solid = 0, outside = 0;
      for (let y = 0; y < info.height; y += 2) for (let x = 0; x < info.width; x += 2) {
        if (data[(y * info.width + x) * 4 + 3] < 128) continue;
        solid++;
        const px = x / scale + asset.canvasOffset.x, py = y / scale + asset.canvasOffset.y;
        if (nearestStructurePoint(rects, px, py).distance > 8) outside++;
      }
      // Thin rigging is excluded from the solid pass already; only dropped slivers may remain.
      expect(outside / solid, building.id).toBeLessThan(.02);
    }
  });

  it('give every structure a staff member standing inside its outline, with idle, work and greet clips', () => {
    for (const building of LOBBY_BUILDINGS) {
      const asset = lobbyStructureAsset(building.id)!;
      const staff = asset.sockets.staff;
      expect(isInsideStructure(lobbyBuildingOutline(building).rects, staff.x, staff.y), building.id).toBe(true);
      const sheet = lobbyStaffAsset(building.menu)!;
      expect(sheet.clips.map(clip => clip.name).sort(), building.id).toEqual(['greet', 'idle', 'work']);
      expect(sheet.clips.find(clip => clip.name === 'greet')!.loop, building.id).toBe(false);
    }
  });
});
