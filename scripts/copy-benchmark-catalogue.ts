#!/usr/bin/env tsx
/**
 * Copy the benchmark catalogue JSON to dist/ so the bundled
 * catalogue loader can resolve it at runtime via createRequire.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const src = path.join(projectRoot, "src", "task-routing", "catalogue", "benchmark-catalogue.json");
const dest = path.join(projectRoot, "dist", "benchmark-catalogue.json");

if (!fs.existsSync(src)) {
  console.warn("[copy-benchmark-catalogue] Source file not found:", src);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log("[copy-benchmark-catalogue] Copied benchmark-catalogue.json to dist/");
