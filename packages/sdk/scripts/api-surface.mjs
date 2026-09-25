#!/usr/bin/env node
/**
 * Guards the public API surface of @sororail/sdk.
 *
 * Emits the declaration (.d.ts) output for everything reachable from
 * src/index.ts, concatenates it in a stable order, and compares it with the
 * committed snapshot in api-surface.snapshot.d.ts. Any change to an exported
 * type fails the check, so a breaking change cannot slip in unnoticed.
 *
 * Usage:
 *   node scripts/api-surface.mjs           compare against the snapshot
 *   node scripts/api-surface.mjs --update  rewrite the snapshot
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const snapshotPath = path.join(root, "api-surface.snapshot.d.ts");
const entry = path.join(root, "src", "index.ts");

const configPath = path.join(root, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);

const program = ts.createProgram([entry], {
  ...parsed.options,
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
});

const emitted = new Map();
const result = program.emit(undefined, (fileName, text) => {
  emitted.set(path.relative(root, fileName).split(path.sep).join("/"), text);
}, undefined, true);

const errors = ts
  .getPreEmitDiagnostics(program)
  .concat(result.diagnostics)
  .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length > 0) {
  console.error(ts.formatDiagnostics(errors, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }));
  process.exit(2);
}

const surface = [...emitted.keys()]
  .filter((name) => name.endsWith(".d.ts"))
  .sort()
  .map((name) => `// ---- ${name} ----\n${emitted.get(name).replace(/\r\n/g, "\n").trimEnd()}\n`)
  .join("\n");

if (process.argv.includes("--update")) {
  fs.writeFileSync(snapshotPath, surface);
  console.log(`Wrote ${path.relative(root, snapshotPath)}`);
  process.exit(0);
}

const expected = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath, "utf8") : null;
if (expected === surface) {
  console.log("Public API surface matches the snapshot.");
  process.exit(0);
}

console.error(
  "The public API of @sororail/sdk changed.\n" +
    "If the change is intentional, run `pnpm --filter @sororail/sdk api:update`,\n" +
    "commit the updated api-surface.snapshot.d.ts, and call out any breaking\n" +
    "change in the PR and in a changeset.",
);
process.exit(1);
