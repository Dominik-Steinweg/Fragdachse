const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const printer = ts.createPrinter({ removeComments: true });
const cache = new Map();
const norm = (node, sf) => printer.printNode(ts.EmitHint.Unspecified, node, sf).replace(/\s+/g, ' ').trim();
function source(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (cache.get(file)?.text === text) return cache.get(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const constants = new Map(), imports = new Map();
  const visit = n => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) constants.set(n.name.text, n.initializer);
    ts.forEachChild(n, visit);
  }; visit(sf);
  for (const n of sf.statements) if (ts.isImportDeclaration(n) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
    for (const e of n.importClause.namedBindings.elements) imports.set(e.name.text, [n.moduleSpecifier.text, e.propertyName?.text ?? e.name.text]);
  }
  const value = { text, sf, constants, imports }; cache.set(file, value); return value;
}
function evaluate(node, file, bindings = {}, seen = new Set()) {
  if (!node) return [];
  const s = source(file), key = norm(node, s.sf);
  if (Object.hasOwn(bindings, key) && !(key === 'depth' && s.constants.has(key))) return bindings[key];
  const token = `${file}:${key}`; if (seen.has(token)) return [];
  const next = new Set(seen).add(token), ev = n => evaluate(n, file, bindings, next);
  if (ts.isNumericLiteral(node)) return [+node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return ev(node.expression);
  if (ts.isPrefixUnaryExpression(node)) return ev(node.operand).map(v => node.operator === ts.SyntaxKind.MinusToken ? -v : v);
  if (ts.isIdentifier(node)) {
    if (s.constants.has(key)) return ev(s.constants.get(key));
    const imp = s.imports.get(key);
    if (imp?.[0].startsWith('.')) {
      const target = path.resolve(path.dirname(file), imp[0]) + '.ts';
      if (fs.existsSync(target)) return evaluate(source(target).constants.get(imp[1]), target, bindings, next);
    }
  }
  if (ts.isPropertyAccessExpression(node)) {
    let object = node.expression, owner = file;
    if (ts.isIdentifier(object)) {
      const imp = s.imports.get(object.text);
      if (imp?.[0].startsWith('.')) {
        owner = path.resolve(path.dirname(file), imp[0]) + '.ts';
        if (!fs.existsSync(owner)) return [];
        object = source(owner).constants.get(imp[1]);
      } else object = s.constants.get(object.text);
      while (object && (ts.isAsExpression(object) || ts.isSatisfiesExpression(object))) object = object.expression;
      if (object && ts.isObjectLiteralExpression(object)) {
        const prop = object.properties.find(p => p.name?.getText() === node.name.text);
        return evaluate(prop?.initializer, owner, bindings, next);
      }
    }
  }
  if (ts.isConditionalExpression(node)) return [...ev(node.whenTrue), ...ev(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const values = [];
    for (const a of ev(node.left)) for (const b of ev(node.right)) {
      const op = node.operatorToken.kind;
      const v = op === ts.SyntaxKind.PlusToken ? a+b : op === ts.SyntaxKind.MinusToken ? a-b
        : op === ts.SyntaxKind.AsteriskToken ? a*b : op === ts.SyntaxKind.SlashToken ? a/b : NaN;
      if (Number.isFinite(v)) values.push(Math.round(v*1e6)/1e6);
    } return [...new Set(values)];
  }
  if (ts.isCallExpression(node) && ['Math.min', 'Math.max'].includes(node.expression.getText())) {
    const args = node.arguments.map(ev); if (args.some(a => !a.length)) return [];
    let combinations = [[]]; for (const a of args) combinations = combinations.flatMap(c => a.map(v => [...c,v]));
    return combinations.map(c => node.expression.getText() === 'Math.min' ? Math.min(...c) : Math.max(...c));
  }
  return [];
}
const helperArguments = { configureAdditiveImage: 1, createEmitter: 5, createEnemyClawGpuLayer: 3,
  createEarthbreakFissureGpuLayer: 3, createFlightRibbonLayer: 2, createTeslaStormBoltGpuLayer: 2, EnemyEyeBatch: 3, HeldItemVisual: 1 };
function inventory(file) {
  const { sf } = source(file), rows = [], counts = new Map();
  const visit = n => {
    let value, selector;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const name = n.expression.getText(sf).split('.').pop();
      if (name === 'setDepth') { value = n.arguments?.[0]; selector = 'setDepth'; }
      else if (name in helperArguments) { value = n.arguments?.[helperArguments[name]]; selector = name; }
    }
    if (ts.isPropertyAssignment(n) && ['depth','boltDepth','backgroundDepth','fillDepth'].includes(n.name.getText(sf))) {
      value = n.initializer; selector = n.name.getText(sf);
    }
    if (value && !(file.endsWith('BloodEffectShared.ts') && ts.isPropertyAssignment(n))) {
      let parent = n, component = selector, method = 'module';
      if (selector === 'setDepth' && ts.isPropertyAccessExpression(n.expression)) {
        let receiver = n.expression.expression;
        while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) receiver = receiver.expression.expression;
        if (ts.isIdentifier(receiver) || ts.isPropertyAccessExpression(receiver)) component = receiver.getText(sf);
      }
      while (parent.parent && !ts.isSourceFile(parent.parent)) {
        parent = parent.parent;
        if (ts.isVariableDeclaration(parent)) component = parent.name.getText(sf);
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) component = parent.left.getText(sf);
        if (ts.isMethodDeclaration(parent) || ts.isFunctionDeclaration(parent)) { method = parent.name?.getText(sf) ?? 'anonymous'; break; }
      }
      const base = `${method}/${component}/${selector}`, ordinal = counts.get(base) ?? 0; counts.set(base, ordinal+1);
      let statement=n;while(statement.parent&&!ts.isStatement(statement))statement=statement.parent;
      let text=statement.getText(sf);
      const object=component.replace(/^this\./,'this\\.').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if(component !== selector) {
        const scope=parent.getText(sf);
        for(const line of scope.split('\n')) if(line.includes(component) && /setBlendMode|makeAdditive/.test(line)) text+='\n'+line;
      }
      const blends=[...text.matchAll(/BlendModes\.(NORMAL|ADD|MULTIPLY|SCREEN)/g)].map(m=>m[1]);
      if(/configureAdditiveImage|makeAdditive/.test(text))blends.push('ADD');
      rows.push({ key: `${base}/${ordinal}`, expression: norm(value,sf), node: value,
        blends:[...new Set(blends.length?blends:['NORMAL'])].sort(), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1 });
    }
    ts.forEachChild(n, visit);
  }; visit(sf);
  const blends = [], cameras = [];
  const scan = n => {
    if (ts.isCallExpression(n) && /(?:setBlendMode|makeAdditive|promoteToClarityCamera)$/.test(n.expression.getText(sf))) {
      const name = n.expression.getText(sf);
      if (name.endsWith('promoteToClarityCamera')) cameras.push(norm(n,sf));
      else blends.push(name.endsWith('makeAdditive') ? 'makeAdditive' : norm(n.arguments[0],sf));
    }
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'blendMode') blends.push(norm(n.initializer,sf));
    ts.forEachChild(n,scan);
  }; scan(sf);
  return { rows, blends: [...new Set(blends)].sort(), cameras: [...new Set(cameras)].sort() };
}
module.exports = { source, evaluate, inventory };
