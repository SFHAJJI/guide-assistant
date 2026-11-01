// Reads a JS file as a syntax tree and returns its literal data. Nothing is executed.
import { readFileSync } from "node:fs";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

class NotLiteral extends Error {}

export function literal(node, scope = {}) {
  switch (node.type) {
    case "Literal": return node.value;
    case "TemplateLiteral":
      if (node.expressions.length) throw new NotLiteral("template");
      return node.quasis[0].value.cooked;
    case "ArrayExpression": return node.elements.map(e => literal(e, scope));
    case "ObjectExpression": {
      const o = {};
      for (const p of node.properties) {
        if (p.type !== "Property" || p.computed) throw new NotLiteral("prop");
        o[p.key.name ?? p.key.value] = literal(p.value, scope);
      }
      return o;
    }
    case "UnaryExpression":
      if (node.operator === "-") return -literal(node.argument, scope);
      if (node.operator === "!") return !literal(node.argument, scope);
      throw new NotLiteral("unary");
    case "BinaryExpression": {
      const a = literal(node.left, scope), b = literal(node.right, scope);
      if (node.operator === "+") return a + b;
      if (node.operator === "*") return a * b;
      if (node.operator === "/") return a / b;
      if (node.operator === "-") return a - b;
      throw new NotLiteral("binary");
    }
    case "MemberExpression":
    case "Identifier": {
      const name = dotted(node);
      if (name && name in scope) return scope[name];
      return { $ref: name };
    }
    default: return { $expr: node.type };
  }
}

function dotted(n) {
  if (n.type === "Identifier") return n.name;
  if (n.type === "MemberExpression" && !n.computed) {
    const l = dotted(n.object);
    return l ? l + "." + n.property.name : null;
  }
  return null;
}

// Every `var X = literal` and `window.X = literal` in the file, at any depth.
export function collect(file, scope = {}) {
  const ast = acorn.parse(readFileSync(file, "utf8"), { ecmaVersion: "latest", locations: true });
  const out = {};
  const put = (name, init) => {
    if (!name || !init) return;
    if (!["ArrayExpression", "ObjectExpression", "BinaryExpression", "TemplateLiteral", "Literal"].includes(init.type)) return;
    try { out[name] = literal(init, scope); } catch (e) { if (!(e instanceof NotLiteral)) throw e; }
  };
  walk.full(ast, n => {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier") put(n.id.name, n.init);
    if (n.type === "AssignmentExpression" && n.operator === "=") put(dotted(n.left), n.right);
  });
  return out;
}
