#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const res = spawnSync(
  process.execPath,
  ["--import", "tsx", path.join(__dirname, "jobs-run-entry.ts")],
  { cwd: rootDir, stdio: "inherit", env: process.env },
);
process.exit(res.status ?? 1);
