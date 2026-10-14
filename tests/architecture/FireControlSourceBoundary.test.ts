import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createFireControlSourceFixture, createFireControlWorldFixture, fireControlConstruction, fireControlCopy } from '../FireControlTestHelper';
import { toLocalTurretFireSource, type TurretFireContext } from '../../src/systems/TurretSystem';
import { TurretControlSystem } from '../../src/systems/TurretControlSystem';
import { TeslaDomeSystem } from '../../src/systems/TeslaDomeSystem';

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}

function visit(node: ts.Node, inspect: (node: ts.Node) => void) {
  inspect(node); ts.forEachChild(node, child => visit(child, inspect));
}

/** Includes type imports, re-exports, import types, dynamic imports and require. */
function moduleReferences(node: ts.Node): string[] {
  const found: string[] = [];
  visit(node, item => {
    if ((ts.isImportDeclaration(item) || ts.isExportDeclaration(item))
      && item.moduleSpecifier && ts.isStringLiteral(item.moduleSpecifier)) found.push(item.moduleSpecifier.text);
    if (ts.isImportTypeNode(item) && ts.isLiteralTypeNode(item.argument)
      && ts.isStringLiteral(item.argument.literal)) found.push(item.argument.literal.text);
    if (ts.isCallExpression(item) && (item.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(item.expression) && item.expression.text === 'require')
      && item.arguments[0] && ts.isStringLiteral(item.arguments[0])) found.push(item.arguments[0].text);
    if (ts.isExternalModuleReference(item) && item.expression && ts.isStringLiteral(item.expression)) found.push(item.expression.text);
  });
  return found;
}

const normalize = (path: string) => path.replace(/\\/g, '/');
function modulePath(file: string, specifier: string): string {
  return normalize(specifier.startsWith('.') ? resolve(dirname(file), specifier) : specifier);
}

/** Follow emitted value imports, so type-only contracts do not load their modules. */
function transitivePhaserImports(roots: readonly string[]): string[] {
  const visited = new Set<string>(), violations: string[] = [];
  const inspect = (file: string, chain: readonly string[]) => {
    if (visited.has(file)) return;
    visited.add(file);
    const emitted = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText;
    const source = ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true);
    for (const specifier of moduleReferences(source)) {
      if (/^phaser(?:\/|$)/i.test(specifier)) violations.push([...chain, file, specifier].map(normalize).join(' -> '));
      if (!specifier.startsWith('.')) continue;
      const path = resolve(dirname(file), specifier);
      const next = [path + '.ts', resolve(path, 'index.ts')].find(existsSync);
      if (next) inspect(next, [...chain, file]);
    }
  };
  roots.forEach(file => inspect(file, []));
  return violations;
}

describe('Feuerleit- und Bomber-Regeln bleiben unabhängig von Phaser, Netzwerk und Szenen', () => {
  it.each(['fireControl', 'bomberSquadron'])('Arrange: alle %s-Module; Act: direkte Modulreferenzen einschließlich Typen lesen; Assert: keine Abhängigkeit auf Phaser, Netzwerk oder Szenen', directory => {
    const modules = files(resolve('src/systems', directory));
    expect(modules.length).toBeGreaterThan(0);
    const forbidden = modules.flatMap(file => moduleReferences(parse(file)).filter(specifier => {
      const target = modulePath(file, specifier);
      return /(^|\/)phaser(?:\/|$)/i.test(target) || /(^|\/)(network|scenes)(\/|$)/i.test(target);
    }).map(specifier => `${normalize(file)} -> ${specifier}`));
    expect(forbidden).toEqual([]);
    expect(transitivePhaserImports(modules)).toEqual([]);
  });
});

describe('Entfernen von Quellen, Einsatzende, Besitzerentfernung und World-Wechsel hinterlassen weder Portale noch Pausen; Clients und Late Join sehen den richtigen Zustand', () => {
  it('Arrange: Original im Konstruktions-Provider und Kopie nur im Feuerquellen-Provider; Act: Kopie feuern lassen; Assert: getTurrets enthält ausschließlich das pausierte Original', () => {
    const f = createFireControlSourceFixture();
    try {
      const original = fireControlConstruction(), copy = fireControlCopy(original);
      f.set([original], [{ ...toLocalTurretFireSource(original), fireState: 'paused' }, copy]);
      f.tick(0);
      expect(f.fire).toHaveBeenCalledOnce();
      expect((f.fire.mock.calls[0][13] as TurretFireContext).source.id).toBe(copy.id);
      expect(f.system.getTurrets()).toEqual([original]);
      f.set([], [copy]); f.tick(1000);
      expect(f.system.getTurrets()).toEqual([]);
      expect(f.fire).toHaveBeenCalledOnce();
    } finally { f.destroy(); }
  });

  it('Arrange: getTurretDefinitions und seine lokalen Abhängigkeiten; Act: AST verfolgen; Assert: der Konstruktionsbestand importiert oder nutzt keine Fire-Control-Module oder Feuerquellen', () => {
    const path = resolve('src/world/WorldCombatGameplayBinding.ts'), source = parse(path);
    const binding = source.statements.find((node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'WorldCombatGameplayBinding');
    expect(binding).toBeDefined();
    const members = new Map(binding!.members.filter(member => member.name && ts.isIdentifier(member.name))
      .map(member => [(member.name as ts.Identifier).text, member]));
    const entry = members.get('getTurretDefinitions');
    expect(entry).toBeDefined();
    // Imports elsewhere in the binding are allowed: M1's deployment owner belongs there.
    const fireControlImports = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || !/fireControl/i.test(modulePath(path, statement.moduleSpecifier.text))) continue;
      if (statement.importClause) visit(statement.importClause, node => {
        if (ts.isIdentifier(node)) fireControlImports.add(node.text);
      });
    }
    const inspected = new Set<ts.Node>(), violations = new Set<string>();
    const inspect = (node: ts.Node) => {
      if (inspected.has(node)) return;
      inspected.add(node);
      for (const specifier of moduleReferences(node)) if (/fireControl/i.test(specifier)) violations.add(specifier);
      visit(node, child => {
        if (ts.isIdentifier(child) && (fireControlImports.has(child.text)
          || /fireControl/i.test(child.text) || child.text === 'getTurretFireSources')) violations.add(child.text);
        if (ts.isPropertyAccessExpression(child) && child.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const dependency = members.get(child.name.text);
          if (dependency) inspect(dependency);
        }
      });
    };
    inspect(entry!);
    expect([...violations]).toEqual([]);
  });

  it('keeps real placement, turret, remote-control, homing and Tesla reads construction-only after host activation', () => {
    const tesla = vi.spyOn(TeslaDomeSystem.prototype, 'setTurretCallbacks');
    const f = createFireControlWorldFixture();
    try {
      const rock = f.add();
      const before = f.placement.getAllRuntimeRocks();
      const capacity = f.placement.getUsedCapacity('inspector');
      expect(f.place(1000, 100).ok).toBe(true);
      f.tick(1000 + f.config.materializeMs, false);
      expect(f.binding.getTurretFireSources()).toHaveLength(2);
      expect(f.binding.getTurretDefinitions().map(t => t.id)).toEqual([rock.id]);
      expect(f.binding.systems!.turret.getTurrets().map(t => t.id)).toEqual([rock.id]);
      expect(f.binding.getOffensiveConstructionSources().map(t => t.id)).toEqual([rock.id]);
      expect(f.placement.getAllRuntimeRocks()).toEqual(before);
      expect(f.placement.getUsedCapacity('inspector')).toBe(capacity);
      const homing = f.homing.setProjectileTargetQueryPort.mock.calls[0][0];
      const emit = vi.fn();
      homing.queryTargets({ targetTypes: ['turrets'] }, 'enemy', 0, 0, 100000, emit);
      expect(emit.mock.calls.filter(([, type]) => type === 'turrets').map(([id]) => id)).toEqual([String(rock.id)]);
      const query = tesla.mock.calls.find(([provider]) => provider !== null)![0]!;
      expect(query().map(t => t.id)).toEqual([rock.id]);
    } finally { f.destroy(); tesla.mockRestore(); }
  });

  it('rejects a nearby deployed copy at the actual occupancy boundary', () => {
    const f = createFireControlWorldFixture();
    try {
      const rock = f.add(); expect(f.place(1000, 100).ok).toBe(true);
      const control = new TurretControlSystem({ getTurrets: () => f.binding.systems!.turret.getTurrets(),
        getActor: () => ({ ...f.point(rock), angle: 0 }), canOccupy: () => true, canEnter: () => true,
        isFriendly: () => true, getInput: () => null, enter() {}, pin() {}, exit() {} });
      expect(control.request('inspector', { action: 'enter', turretId: 'fc-copy:1:0' })).toBe(false);
      expect(control.request('inspector', { action: 'enter', turretId: rock.id })).toBe(true);
    } finally { f.destroy(); }
  });
});
