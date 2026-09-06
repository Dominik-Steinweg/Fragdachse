import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function sources(directory: string): ts.SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts')
      ? [ts.createSourceFile(path.replaceAll('\\', '/'), readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)]
      : [];
  });
}
function nodes(source: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node): void => { result.push(node); ts.forEachChild(node, visit); };
  visit(source);
  return result;
}
const production = sources('src');
const syntax = new Map(production.map(source => [source, nodes(source)]));
function identifiers(source: ts.SourceFile): Set<string> {
  return new Set(syntax.get(source)!.filter(ts.isIdentifier).map(node => node.text));
}
function imports(source: ts.SourceFile): string[] {
  return syntax.get(source)!.flatMap(node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return [node.moduleSpecifier.text];
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteral(node.argument.literal)) return [node.argument.literal.text];
    return [];
  });
}

// Authority roles, not an inventory of callers: newly added consumers are checked as well.
const internalStateOwners = new Set([
  'WorldProjectileRuntime.ts', 'ProjectileStore.ts', 'ProjectileRuntimeRecord.ts',
  'ProjectileFlightProcessor.ts', 'ProjectileCollisionProcessor.ts',
  'ProjectileLifecycleProcessor.ts', 'ProjectileMiniRocketProcessor.ts',
]);
const projections = new Set([
  'ProjectileClientReplica.ts', 'ProjectileReplicationAdapter.ts', 'ProjectilePresentationRuntime.ts',
]);

describe('Projectile Runtime – ownership and dependency ratchets', () => {
  it('rejects legacy authority and record APIs throughout production', () => {
    for (const source of production) {
      const names = identifiers(source);
      for (const forbidden of ['ProjectileManager', 'TrackedProjectile', 'ProjectileStoreAccess',
        'getActiveProjectiles', 'getProjectileById', 'spawnProjectileConfig']) {
        expect(names.has(forbidden), source.fileName + ': ' + forbidden).toBe(false);
      }
    }
  });

  it('restricts mutable state and registry access to the authoritative owners', () => {
    for (const source of production) {
      const name = basename(source.fileName);
      const names = identifiers(source);
      if (!internalStateOwners.has(name)) {
        expect(names.has('ProjectileRuntimeRecord'), source.fileName).toBe(false);
        expect(imports(source).some(path => path.endsWith('/ProjectileRuntimeRecord')), source.fileName).toBe(false);
      }
      if (name !== 'WorldProjectileRuntime.ts' && name !== 'ProjectileStore.ts') {
        expect(names.has('ProjectileStore'), source.fileName).toBe(false);
        expect(imports(source).some(path => path.endsWith('/ProjectileStore')), source.fileName).toBe(false);
      }
    }
  });

  it('keeps simulation and physics independent of transport, renderers and concrete domain owners', () => {
    for (const source of production.filter(source => internalStateOwners.has(basename(source.fileName))
      || basename(source.fileName) === 'ProjectilePhysicsBinding.ts')) {
      for (const path of imports(source)) {
        // The World composition may reference passive light/shadow sample types.
        const passiveSample = path.endsWith('/ShadowConfig') || path.endsWith('/LightingConfig');
        expect(path.includes('/network/') || path.includes('/audio/')
          || (path.includes('/effects/') && !passiveSample)
          || /\/(CombatSystem|TeslaDomeSystem|EnergyShieldSystem|WorldPlayerGameplayRuntime)$/.test(path),
        source.fileName + ' -> ' + path).toBe(false);
      }
      for (const node of syntax.get(source)!) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          expect(['Date.now', 'performance.now'].includes(node.expression.getText(source)), source.fileName).toBe(false);
        }
      }
      if (basename(source.fileName) !== 'WorldProjectileRuntime.ts') {
        expect(imports(source).some(path => /Projectile(ClientReplica|ReplicationAdapter|PresentationRuntime)$/.test(path)), source.fileName).toBe(false);
      }
    }
  });

  it('keeps non-authoritative projections free of gameplay mutation and physics handles', () => {
    for (const source of production.filter(source => projections.has(basename(source.fileName)))) {
      const names = identifiers(source);
      for (const forbidden of ['ProjectileRuntimeRecord', 'ProjectilePhysicsHandle', 'ProjectilePhysicsBinding',
        'WorldProjectileRuntime', 'CombatSystem', 'applyDamage', 'resolveDirectImpact']) {
        expect(names.has(forbidden), source.fileName + ': ' + forbidden).toBe(false);
      }
    }
  });

  it('keeps world consumers and execution behind semantic ports', () => {
    for (const source of production.filter(source => source.fileName.startsWith('src/world/')
      || /\/(CombatSystem|DetonationSystem|TranslocatorSystem|CoopDefenseEnemyDodgeSystem|CoopDefenseEnemyAbilitySystem)\.ts$/.test(source.fileName))) {
      for (const path of imports(source)) {
        expect(/\/(WorldProjectileRuntime|ProjectilePhysicsBinding|ProjectileStore|ProjectileCollisionProcessor)$/.test(path),
          source.fileName + ' -> ' + path).toBe(false);
      }
    }
  });

  it('keeps style dispatch out of collision, flight, combat and guidance', () => {
    for (const source of production.filter(source => /\/(Projectile(FlightProcessor|CollisionProcessor|LifecycleProcessor|MiniRocketProcessor|HomingController)|CombatSystem)\.ts$/.test(source.fileName))) {
      expect(identifiers(source).has('projectileStyle'), source.fileName).toBe(false);
    }
  });

  it('keeps the physics port technical and the combat port specific to combat', () => {
    const physics = production.find(source => source.fileName === 'src/projectile/ProjectilePhysicsBinding.ts')!;
    const combat = production.find(source => source.fileName === 'src/projectile/ProjectileCombatPort.ts')!;
    for (const forbidden of ['ProjectileExplosionRequest', 'ProjectileBurnAugment', 'ProjectileCombatPort', 'ProjectileRuntimeRecord']) {
      expect(identifiers(physics).has(forbidden), forbidden).toBe(false);
    }
    for (const path of imports(combat)) {
      expect(/\/(systems|world|effects)\//.test(path), path).toBe(false);
    }
    const port = combat.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'ProjectileCombatPort') as ts.InterfaceDeclaration;
    for (const member of port.members) {
      for (const node of nodes(member)) {
        if (ts.isIdentifier(node)) expect(['ProjectileExplosionRequest', 'ProjectileGrenadePayloadRequest',
          'ProjectileRuntimeRecord', 'ProjectilePhysicsHandle'].includes(node.text), node.text).toBe(false);
      }
    }
  });
});
