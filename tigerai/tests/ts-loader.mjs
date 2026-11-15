// Test-only module hooks: resolve extension-less relative imports to .ts and replace the heavy pi runtime with stubs.
//   node --experimental-strip-types --import ./tigerai/tests/register.mjs --test tigerai/tests/gen1-backend.test.mjs
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";

const STUBS = new Map([
  ["lib/rpc-manager", "stubs/rpc-manager.ts"],
  ["lib/session-reader", "stubs/session-reader.ts"],
]);

export async function resolve(specifier, context, next) {
  if (specifier === "next/server") return next("next/server.js", context);
  if (specifier.startsWith("@/")) {
    // the app's "@/" alias (tsconfig paths): the repository root
    const base = pathResolve(dirname(fileURLToPath(import.meta.url)), "../..", specifier.slice(2));
    for (const ext of ["", ".ts", "/index.ts"]) if (/\.[a-z]+$/.test(base + ext) && existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = pathResolve(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const [key, stub] of STUBS) {
      if (base.endsWith("/" + key)) return { url: pathToFileURL(pathResolve(dirname(fileURLToPath(import.meta.url)), stub)).href, shortCircuit: true };
    }
    if (!/\.[a-z]+$/.test(specifier)) {
      for (const ext of [".ts", "/index.ts"]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}
