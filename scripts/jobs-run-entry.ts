import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runScheduledJobs } from "../src/server/jobs/runner";

function loadEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0 && !(t.slice(0, eq).trim() in process.env)) {
      process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  }
}

loadEnv(path.resolve(process.cwd(), ".env.local"));
loadEnv(path.resolve(process.cwd(), ".env"));

runScheduledJobs()
  .then((report) => {
    console.log("[TNTH-WORK][JOBS]", JSON.stringify(report));
    process.exit(report.errors.length > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("[TNTH-WORK][JOBS] Fatal error:", err);
    process.exit(1);
  });
