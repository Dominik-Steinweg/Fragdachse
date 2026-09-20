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
  'ProjectileDistanceScaling.ts', // Private flight/contact bookkeeping inside the same authority.
  'ProjectileLifecycleProcessor.ts', 'ProjectileMiniRocketProcessor.ts',
]);
const projections = new Set([
  'ProjectileClientReplica.ts', 'ProjectileReplicationAdapter.ts', 'ProjectilePresentationRuntime.ts',
]);

/** Local AST guard: opaque copies are legal; interpreting style as a decision is not.
 * Track local scalar aliases by symbol so renaming/destructuring cannot hide a decision.
 * This is not interprocedural data-flow analysis; the runtime contract is tested separately.
 */
function styleDecisions(source: ts.SourceFile): string[] {
  const options = { noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = file => file === source.fileName ? source : undefined;
  const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
  const all = nodes(source);
  const aliases = new Set<ts.Symbol>();
  const isStyleKey = (node: ts.Node) => (ts.isIdentifier(node) || ts.isStringLiteral(node))
    && node.text === 'projectileStyle';
  const readsStyle = (node: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(node) && isStyleKey(node.name)) return true;
    if (ts.isElementAccessExpression(node) && isStyleKey(node.argumentExpression)) return true;
    if (ts.isIdentifier(node)) {
      if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return false;
      return node.text === 'projectileStyle' || aliases.has(checker.getSymbolAtLocation(node)!);
    }
    // A metadata envelope is not itself a scalar style value.
    if (ts.isObjectLiteralExpression(node)) return false;
    return ts.forEachChild(node, readsStyle) === true;
  };
  let changed: boolean;
  do {
    changed = false;
    for (const node of all) {
      const name = ts.isVariableDeclaration(node) && node.initializer && readsStyle(node.initializer)
        ? node.name
        : ts.isBindingElement(node) && isStyleKey(node.propertyName ?? node.name) ? node.name
        : ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && readsStyle(node.right) ? node.left : undefined;
      if (!name || !ts.isIdentifier(name)) continue;
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol && !aliases.has(symbol)) { aliases.add(symbol); changed = true; }
    }
  } while (changed);
  return all.filter(node => {
    if (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isWhileStatement(node)
      || ts.isDoStatement(node)) return readsStyle(node.expression);
    if (ts.isConditionalExpression(node)) return readsStyle(node.condition);
    if (ts.isForStatement(node)) return !!node.condition && readsStyle(node.condition);
    if (ts.isElementAccessExpression(node)) return readsStyle(node.argumentExpression);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      // Inspecting the style itself or testing membership is not opaque transport.
      return readsStyle(node.expression.expression)
        || ['includes', 'indexOf', 'has'].includes(node.expression.name.text) && node.arguments.some(readsStyle);
    }
    if (ts.isBinaryExpression(node)) {
      // Assignment and nullish metadata defaults preserve the opaque value.
      return ![ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)
        && (readsStyle(node.left) || readsStyle(node.right));
    }
    if (ts.isPrefixUnaryExpression(node)) return readsStyle(node.operand);
    return false;
  }).map(node => node.getText(source));
}

describe('style decision AST guard', () => {
  it.each([
    'send({ projectileStyle: record.presentation.projectileStyle });',
    'const style = record["projectileStyle"]; send({ projectileStyle: style });',
    'const { projectileStyle: style } = record; return { projectileStyle: style };',
    'return enabled ? { projectileStyle: record.projectileStyle } : undefined;',
    'return { projectileStyle: record.projectileStyle ?? "bullet" };',
    'send({ ...record.presentation });',
    'const style = record.projectileStyle; function other(style: boolean) { if (style) hit(); }',
  ])('allows opaque forwarding: %s', code => {
    expect(styleDecisions(ts.createSourceFile('fixture.ts', code, ts.ScriptTarget.Latest, true))).toEqual([]);
  });

  it.each([
    'if (record.projectileStyle === "ball") hit();',
    'switch (record["projectileStyle"]) { case "ball": hit(); }',
    'return record.projectileStyle ? 10 : 20;',
    'record.projectileStyle && hit();',
    'const style = record.projectileStyle; const alias = style; if (alias) hit();',
    'const { projectileStyle: style } = record; switch (style) { case "ball": hit(); }',
    'let style; style = record.projectileStyle; return style === "ball";',
    'return damageByStyle[record.projectileStyle];',
    'return ["ball", "energy_ball"].includes(record.projectileStyle);',
    'const style = record.projectileStyle; return style.startsWith("energy");',
    'while (record.projectileStyle) hit();',
    'return !record.projectileStyle;',
  ])('rejects style decisions: %s', code => {
    expect(styleDecisions(ts.createSourceFile('fixture.ts', code, ts.ScriptTarget.Latest, true)).length).toBeGreaterThan(0);
  });
});

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
          || /\/(WorldCombatCore|TeslaDomeSystem|EnergyShieldSystem|WorldPlayerGameplayRuntime)$/.test(path),
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
        'WorldProjectileRuntime', 'WorldCombatCore', 'applyDamage', 'resolveDirectImpact']) {
        expect(names.has(forbidden), source.fileName + ': ' + forbidden).toBe(false);
      }
    }
  });

  it('keeps world consumers and execution behind semantic ports', () => {
    for (const source of production.filter(source => source.fileName.startsWith('src/world/')
      || /\/(WorldCombatCore|DetonationSystem|TranslocatorSystem|CoopDefenseEnemyDodgeSystem|CoopDefenseEnemyAbilitySystem)\.ts$/.test(source.fileName))) {
      for (const path of imports(source)) {
        expect(/\/(WorldProjectileRuntime|ProjectilePhysicsBinding|ProjectileStore|ProjectileCollisionProcessor)$/.test(path),
          source.fileName + ' -> ' + path).toBe(false);
      }
    }
  });

  it('keeps style dispatch out of collision, flight, combat and guidance', () => {
    for (const source of production.filter(source => /\/(Projectile(FlightProcessor|CollisionProcessor|LifecycleProcessor|MiniRocketProcessor|HomingController)|WorldCombatCore)\.ts$/.test(source.fileName))) {
      expect(styleDecisions(source), source.fileName).toEqual([]);
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
