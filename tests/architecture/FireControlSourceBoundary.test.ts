import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createFireControlSourceFixture, fireControlConstruction, fireControlCopy } from '../FireControlTestHelper';
import { toLocalTurretFireSource, type TurretFireContext } from '../../src/systems/TurretSystem';

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

describe('Feuerleit-Regeln bleiben unabhängig von Phaser, Netzwerk und Szenen', () => {
  it('Arrange: alle Fire-Control-Module; Act: direkte Modulreferenzen einschließlich Typen lesen; Assert: keine Abhängigkeit auf Phaser, Netzwerk oder Szenen', () => {
    const modules = files(resolve('src/systems/fireControl'));
    expect(modules.length).toBeGreaterThan(0);
    const forbidden = modules.flatMap(file => moduleReferences(parse(file)).filter(specifier => {
      const target = modulePath(file, specifier);
      return /(^|\/)phaser(?:\/|$)/i.test(target) || /(^|\/)(network|scenes)(\/|$)/i.test(target);
    }).map(specifier => `${normalize(file)} -> ${specifier}`));
    expect(forbidden).toEqual([]);
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

  // M1: echte Konstruktion-Consumer mit dem Einsatz-Owner zusammenstecken.
  it.todo('Arrange: bemannbare Konstruktion und nahe Kopie; Act: Bemannungsziele abfragen und Kopien-ID anfordern; Assert: nur das Original ist auswählbar und die Kopie wird abgelehnt');
  it.todo('Arrange: Original, Kopie und Relais-Projektor; Act: Reparatur-, Abbau- und Interaktionsziele sowie Baukapazität abfragen; Assert: nur echte Konstruktionen erscheinen und Kopie sowie Projektor verbrauchen keine Baukapazität');
  it.todo('Arrange: gegnerische Konstruktion und näher liegende Kopie; Act: Homing-Zielsuche ausführen; Assert: Kopie und Projektor sind keine anvisierbaren Ziele');
  it.todo('Arrange: Konstruktionen und aktive Kopien desselben Besitzers; Act: Fernsteuerungsquellen abfragen; Assert: Ergebnis enthält nur Konstruktions-IDs und keine Kopien-ID');
  it.todo('Arrange: gegnerisches Original und Kopie im Tesla-Radius; Act: Tesla-Ziele ermitteln; Assert: nur das Original erhält einen Konstruktionstreffer');
});
