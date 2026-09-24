import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (!existsSync("dist/web/index.html") || !existsSync("dist/server/apps/server/src/index.js")) {
  console.log("Building Harbor for the first launch…");
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}
