#!/usr/bin/env node
/**
 * Fails the build when the client JavaScript for apps/web grows past a budget.
 *
 * Run after `next build`. For each app route it sums the gzipped size of the
 * unique JS files the route loads (from .next/app-build-manifest.json), and
 * fails if any route exceeds BUNDLE_BUDGET_KB (default 750). If that manifest
 * is not produced by the installed Next.js version, it falls back to the total
 * gzipped size of every client chunk under .next/static/chunks.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nextDir = path.join(root, ".next");
const budgetKb = Number(process.env.BUNDLE_BUDGET_KB ?? 750);

if (!fs.existsSync(nextDir)) {
  console.error("No .next directory found. Run `pnpm build` first.");
  process.exit(2);
}

const gzipSizes = new Map();
function gzipKb(file) {
  if (!gzipSizes.has(file)) {
    const bytes = zlib.gzipSync(fs.readFileSync(path.join(nextDir, file))).length;
    gzipSizes.set(file, bytes / 1024);
  }
  return gzipSizes.get(file);
}

function listChunks(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listChunks(full);
    return entry.name.endsWith(".js") ? [path.relative(nextDir, full)] : [];
  });
}

const manifestPath = path.join(nextDir, "app-build-manifest.json");
const measurements = [];

if (fs.existsSync(manifestPath)) {
  const { pages } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const [route, files] of Object.entries(pages)) {
    const unique = [...new Set(files.filter((file) => file.endsWith(".js")))];
    measurements.push({ name: route, kb: unique.reduce((sum, file) => sum + gzipKb(file), 0) });
  }
} else {
  const chunks = listChunks(path.join(nextDir, "static", "chunks"));
  measurements.push({
    name: "all client chunks",
    kb: chunks.reduce((sum, file) => sum + gzipKb(file), 0),
  });
}

measurements.sort((a, b) => b.kb - a.kb);
console.log(`Client JS (gzip), budget ${budgetKb} kB per entry:`);
for (const { name, kb } of measurements) {
  console.log(`  ${kb.toFixed(1).padStart(8)} kB  ${name}`);
}

const over = measurements.filter(({ kb }) => kb > budgetKb);
if (over.length > 0) {
  console.error(
    `\n${over.length} entr${over.length === 1 ? "y is" : "ies are"} over the ${budgetKb} kB budget. ` +
      "Check for a dependency pulled into the client bundle, or raise BUNDLE_BUDGET_KB deliberately.",
  );
  process.exit(1);
}
