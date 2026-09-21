import ts from 'typescript';
import { stable, type JsonObject } from '../shared/json';

/** Preserve original tokens outside changed values, including mixed compact/multiline JSON. */
export function updateJsonText(text: string, next: JsonObject): string {
  const old = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (stable(old) === stable(next)) return text;
  const source = ts.parseJsonText('map.json', text);
  const root = (source.statements[0] as ts.ExpressionStatement).expression;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = text.match(/\r?\n([\t ]+)"/)?.[1] ?? '  ';
  const paddingAt = (offset: number) => text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset).match(/^\s*/)?.[0] ?? '';
  const format = (value: unknown, padding: string) => JSON.stringify(value, null, indent).replaceAll('\n', newline + padding);
  const render = (node: ts.Node, a: unknown, b: unknown): string => {
    if (stable(a) === stable(b)) return text.slice(node.getStart(source), node.end);
    if (ts.isObjectLiteralExpression(node) && a && b && !Array.isArray(b) && typeof b === 'object') {
      const oldObject = a as JsonObject, newObject = b as JsonObject;
      const properties = new Map(node.properties.map(p => [(p.name as ts.StringLiteral).text, p as ts.PropertyAssignment]));
      const keys = Object.keys(newObject);
      const sameKeys = Object.keys(oldObject).length === keys.length && keys.every(k => properties.has(k));
      if (sameKeys) {
        let cursor = node.getStart(source), output = '';
        for (const [key, p] of properties) {
          output += text.slice(cursor, p.initializer.getStart(source)) + render(p.initializer, oldObject[key], newObject[key]); cursor = p.initializer.end;
        }
        return output + text.slice(cursor, node.end);
      }
      const first = node.properties[0];
      const multiline = text.slice(node.getStart(source), node.end).includes('\n');
      const padding = paddingAt(node.getStart(source));
      const prefix = multiline ? newline + padding + indent : ' ';
      const entries = keys.map(key => {
        const property = properties.get(key);
        if (!property) return prefix + JSON.stringify(key) + ': ' + format(newObject[key], padding + indent);
        return text.slice(property.pos, property.initializer.getStart(source)) + render(property.initializer, oldObject[key], newObject[key]);
      });
      const last = node.properties[node.properties.length - 1];
      const suffix = last ? text.slice(last.end, node.end - 1) : (multiline ? newline + padding : ' ');
      return '{' + entries.join(',') + (first ? suffix : '') + '}';
    }
    if (ts.isArrayLiteralExpression(node) && Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      let cursor = node.getStart(source), output = '';
      node.elements.forEach((element, i) => { output += text.slice(cursor, element.getStart(source)) + render(element, a[i], b[i]); cursor = element.end; });
      return output + text.slice(cursor, node.end);
    }
    return format(b, paddingAt(node.getStart(source)));
  };
  const result = text.slice(0, root.getStart(source)) + render(root, old, next) + text.slice(root.end);
  if (stable(JSON.parse(result.replace(/^\uFEFF/, ''))) !== stable(next)) throw Error('JSON-Ausgabe stimmt nicht mit dem Entwurf überein.');
  return result;
}
