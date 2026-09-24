import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import type { Volume } from "../../../packages/shared/types.js";
export function parseMounts(text: string): string[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" ")[4])
    .filter((v): v is string => !!v)
    .map((v) => v.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8))))
    .filter((v) => v === "/" || !/^\/(proc|sys|dev)(\/|$)/.test(v));
}
export async function discoverVolumes(config: Config): Promise<Volume[]> {
  const home = os.homedir();
  const candidates = new Set<string>(config.allVolumes ? [home] : config.roots);
  if (config.allVolumes) {
    if (process.platform === "win32") {
      for (let i = 65; i <= 90; i++) candidates.add(`${String.fromCharCode(i)}:\\`);
    } else {
      candidates.add("/");
      if (process.platform === "linux")
        try {
          for (const mount of parseMounts(await fs.readFile("/proc/self/mountinfo", "utf8")))
            candidates.add(mount);
        } catch {
          /* Root remains available. */
        }
      for (const base of process.platform === "darwin"
        ? ["/Volumes"]
        : ["/mnt", "/media", `/run/media/${os.userInfo().username}`])
        try {
          for (const d of await fs.readdir(base, { withFileTypes: true }))
            if (d.isDirectory()) candidates.add(path.join(base, d.name));
        } catch {
          /* Optional mount directory. */
        }
    }
  }
  const roots = await Promise.all(
    [...candidates].map(async (p) => {
      try {
        if (!(await fs.stat(p)).isDirectory()) return null;
        await fs.access(p, fs.constants.R_OK);
        let space;
        try {
          space = await fs.statfs(p);
        } catch {}
        return {
          id: createHash("sha256").update(p).digest("hex").slice(0, 16),
          name: p === home ? "Home" : p === "/" ? "System disk" : path.basename(p) || p,
          path: p,
          kind: p === home ? "home" : "volume",
          ...(space ? { total: space.blocks * space.bsize, free: space.bavail * space.bsize } : {}),
        } as Volume;
      } catch {
        return null;
      }
    }),
  );
  return roots.filter((v): v is Volume => !!v);
}
