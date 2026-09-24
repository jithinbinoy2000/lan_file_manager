import fs from "node:fs/promises";
import path from "node:path";
import type { Volume, Location } from "../../../packages/shared/types.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function contained(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}
export function validName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" ||
    !name ||
    name === "." ||
    name === ".." ||
    /[\x00-\x1f/\\<>:"|?*]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name) ||
    Buffer.byteLength(name) > 255
  )
    throw new HttpError(
      400,
      "Choose a valid filename (no separators, reserved names, or trailing spaces/dots).",
    );
}
export class Paths {
  constructor(
    public volumes: Volume[],
    public privateDir: string,
  ) {}
  volume(id: string) {
    const v = this.volumes.find((v) => v.id === id);
    if (!v) throw new HttpError(404, "Volume unavailable. Refresh volumes and check the drive connection.");
    return v;
  }
  async resolve(loc: Location, mode: "read" | "entry" | "create" = "read") {
    if (!loc || typeof loc.root !== "string" || typeof loc.path !== "string")
      throw new HttpError(400, "A volume and relative path are required.");
    const v = this.volume(loc.root);
    if (
      path.isAbsolute(loc.path) ||
      (process.platform === "win32" && loc.path.includes(":")) ||
      loc.path.includes("\\") ||
      loc.path.split("/").some((s) => s === "..") ||
      /[\x00-\x1f]/.test(loc.path)
    )
      throw new HttpError(403, "Invalid path.");
    const target = path.resolve(v.path, loc.path);
    const root = await fs.realpath(v.path);
    let canonical: string;
    if (mode === "read") canonical = await fs.realpath(target);
    else {
      canonical =
        target === v.path ? root : path.join(await fs.realpath(path.dirname(target)), path.basename(target));
    }
    if (!contained(root, canonical))
      throw new HttpError(
        403,
        "This symlink points outside the selected volume. Open its destination from an enabled volume.",
      );
    const privateReal = await fs.realpath(this.privateDir).catch(() => this.privateDir);
    if (contained(privateReal, canonical))
      throw new HttpError(403, "Application configuration and trash storage are private.");
    if (mode !== "read" && (canonical === root || contained(canonical, privateReal)))
      throw new HttpError(403, "Volume roots and application storage cannot be modified.");
    return canonical;
  }
  async assertTree(root: string, signal?: AbortSignal) {
    let count = 0;
    const walk = async (p: string) => {
      signal?.throwIfAborted();
      if (++count > 100000)
        throw new HttpError(413, "Operation exceeds 100,000 entries. Split it into smaller folders.");
      if (contained(p, this.privateDir))
        throw new HttpError(403, "This folder contains private application storage.");
      const s = await fs.lstat(p);
      if (s.isSymbolicLink())
        throw new HttpError(
          400,
          "Recursive operations on symbolic links are disabled. Operate on the link itself or open its destination.",
        );
      if (s.isDirectory()) {
        for await (const e of await fs.opendir(p)) await walk(path.join(p, e.name));
      } else if (!s.isFile()) throw new HttpError(400, "Special devices and sockets cannot be copied.");
    };
    await walk(root);
  }
}
export const location = (root: unknown, p: unknown): Location => ({
  root: String(root ?? ""),
  path: String(p ?? ""),
});
