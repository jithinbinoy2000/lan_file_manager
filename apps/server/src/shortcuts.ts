import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import type { Shortcut, Volume } from "../../../packages/shared/types.js";
import { contained, Paths } from "./paths.js";

/** Only publish shortcuts that exist and are reachable through an enabled root. */
export async function discoverShortcuts(
  volumes: Volume[],
  privateDir: string,
  home = os.homedir(),
): Promise<Shortcut[]> {
  const locations: Array<[Shortcut["id"], string, string]> = [
    ["home", "My files", home],
    ["downloads", "Downloads", path.join(home, "Downloads")],
    ["documents", "Documents", path.join(home, "Documents")],
    ["pictures", "Pictures", path.join(home, "Pictures")],
    ["videos", "Videos", path.join(home, process.platform === "darwin" ? "Movies" : "Videos")],
    ["music", "Music", path.join(home, "Music")],
  ];
  if (process.platform === "linux") {
    try {
      const text = await fs.readFile(path.join(home, ".config/user-dirs.dirs"), "utf8");
      const keys: Record<string, string> = {
        downloads: "DOWNLOAD",
        documents: "DOCUMENTS",
        pictures: "PICTURES",
        videos: "VIDEOS",
        music: "MUSIC",
      };
      for (const item of locations) {
        const line = text.match(new RegExp(`^XDG_${keys[item[0]]}_DIR="([^"]+)"`, "m"));
        if (line) {
          const value = line[1].replace(/^\$HOME(?=\/|$)/, home);
          if (path.isAbsolute(value) && !value.includes("$")) item[2] = value;
        }
      }
    } catch {
      /* Standard directory names are the fallback. */
    }
  }
  const paths = new Paths(volumes, privateDir),
    result: Shortcut[] = [];
  for (const [id, name, candidate] of locations) {
    try {
      const real = await fs.realpath(candidate);
      const roots = await Promise.all(
        volumes.map(async (volume) => ({ volume, real: await fs.realpath(volume.path) })),
      );
      const match = roots
        .filter((v) => contained(v.real, real))
        .sort((a, b) => b.real.length - a.real.length)[0];
      if (!match) continue;
      const loc = { root: match.volume.id, path: path.relative(match.real, real).split(path.sep).join("/") };
      const resolved = await paths.resolve(loc);
      const directory = await fs.opendir(resolved);
      await directory.close();
      result.push({ id, name, ...loc });
    } catch {
      /* Missing, restricted and disconnected shortcuts are not clickable UI entries. */
    }
  }
  return result;
}
