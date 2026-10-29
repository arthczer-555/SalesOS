// Hook de résolution Node pour exécuter le TypeScript de lib/ sans tsx (Node
// 24+ retire les types nativement) : "@/x" -> racine du repo, et ".ts" / ".tsx"
// / "/index.ts" ajoutés aux imports relatifs sans extension.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function withExtension(absPath) {
  if (existsSync(absPath) && statSync(absPath).isFile()) return absPath;
  for (const ext of [".ts", ".tsx", ".mts", ".js", ".mjs"]) {
    if (existsSync(absPath + ext)) return absPath + ext;
  }
  for (const idx of ["index.ts", "index.tsx", "index.js"]) {
    const p = path.join(absPath, idx);
    if (existsSync(p)) return p;
  }
  return null;
}

export function resolve(specifier, context, next) {
  // Les dépendances (souvent en CommonJS) gardent la résolution standard.
  if (context.parentURL?.includes("/node_modules/")) return next(specifier, context);
  let abs = null;
  if (specifier.startsWith("@/")) abs = path.join(ROOT, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    abs = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (abs) {
    const found = withExtension(abs);
    if (found) return next(pathToFileURL(found).href, context);
  }
  return next(specifier, context);
}
