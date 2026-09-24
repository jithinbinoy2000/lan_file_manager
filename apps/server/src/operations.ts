import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Job, Location, TrashItem } from "../../../packages/shared/types.js";
import { Paths, HttpError, validName, contained } from "./paths.js";
export const exists = async (p: string) => {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
};
async function hash(p: string, signal: AbortSignal) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(p, { signal })) digest.update(chunk);
  return digest.digest("hex");
}
export async function verifiedCopy(source: string, dest: string, job: Job, signal: AbortSignal) {
  signal.throwIfAborted();
  const before = await fs.lstat(source);
  if (before.isSymbolicLink() || (!before.isFile() && !before.isDirectory()))
    throw new HttpError(400, "Copying links and special files is not supported.");
  if (before.isDirectory()) {
    await fs.mkdir(dest, { mode: before.mode | 0o700 });
    for await (const e of await fs.opendir(source))
      await verifiedCopy(path.join(source, e.name), path.join(dest, e.name), job, signal);
    const after = await fs.stat(source);
    if (after.mtimeMs !== before.mtimeMs)
      throw new HttpError(409, "Source folder changed during copying. Source was retained.");
    await fs.utimes(dest, before.atime, before.mtime);
    await fs.chmod(dest, before.mode);
  } else {
    const digest = createHash("sha256");
    await pipeline(
      createReadStream(source),
      new Transform({
        transform(chunk, _, cb) {
          digest.update(chunk);
          job.bytes += chunk.length;
          cb(null, chunk);
        },
      }),
      createWriteStream(dest, { flags: "wx", mode: before.mode | 0o600 }),
      { signal },
    );
    const after = await fs.stat(source);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      (await hash(dest, signal)) !== digest.digest("hex")
    )
      throw new HttpError(409, "Copy verification failed or source changed. Source was retained.");
    await fs.utimes(dest, before.atime, before.mtime);
    const handle = await fs.open(dest, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.chmod(dest, before.mode);
  }
}
export async function verifyTree(source: string, dest: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const a = await fs.lstat(source),
    b = await fs.lstat(dest);
  if (a.isSymbolicLink() || b.isSymbolicLink() || a.isDirectory() !== b.isDirectory())
    throw new HttpError(409, "Source changed during transfer; source retained.");
  if (a.isDirectory()) {
    const left = (await fs.readdir(source)).sort(),
      right = (await fs.readdir(dest)).sort();
    if (JSON.stringify(left) !== JSON.stringify(right))
      throw new HttpError(409, "Source folder changed during transfer; source retained.");
    for (const name of left) await verifyTree(path.join(source, name), path.join(dest, name), signal);
  } else if (
    !a.isFile() ||
    !b.isFile() ||
    a.size !== b.size ||
    (await hash(source, signal)) !== (await hash(dest, signal))
  )
    throw new HttpError(409, "Source changed during transfer; source retained.");
}
export class Operations {
  constructor(
    public paths: Paths,
    public trashDir: string,
  ) {}
  async trash(source: string, loc: Location, job: Job, signal: AbortSignal) {
    const id = randomUUID(),
      dir = path.join(this.trashDir, id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const meta: TrashItem = { id, name: path.basename(source), deletedAt: Date.now(), ...loc };
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
    try {
      await fs.rename(source, path.join(dir, "content"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") {
        await fs.rm(dir, { recursive: true, force: true });
        throw e;
      }
      try {
        await this.paths.assertTree(source, signal);
        await verifiedCopy(source, path.join(dir, "content"), job, signal);
        await verifyTree(source, path.join(dir, "content"), signal);
        signal.throwIfAborted();
      } catch (error) {
        await fs.rm(dir, { recursive: true, force: true });
        throw error;
      }
      // Once removal starts, retain the verified recovery copy even if removal fails.
      await fs.rm(source, { recursive: true });
    }
  }
  async trashList(): Promise<TrashItem[]> {
    await fs.mkdir(this.trashDir, { recursive: true, mode: 0o700 });
    const items: TrashItem[] = [];
    for (const name of await fs.readdir(this.trashDir)) {
      try {
        const dir = path.join(this.trashDir, name);
        if (await exists(path.join(dir, "content")))
          items.push(JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")));
      } catch {
        /* Incomplete metadata is not exposed. */
      }
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }
  async restore(id: string, job: Job, signal: AbortSignal) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, "Invalid trash item.");
    const dir = path.join(this.trashDir, id),
      source = path.join(dir, "content"),
      meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")) as TrashItem;
    const dest = await this.paths.resolve(meta, "create");
    if (await exists(dest))
      throw new HttpError(
        409,
        "An item already exists at the original location. Rename it before restoring.",
      );
    try {
      await fs.rename(source, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      const staging = path.join(path.dirname(dest), `.harbor-part-${randomUUID()}`);
      try {
        await verifiedCopy(source, staging, job, signal);
        await verifyTree(source, staging, signal);
        if (await exists(dest)) throw new HttpError(409, "Destination appeared during restore.");
        await fs.rename(staging, dest);
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true });
        throw error;
      }
      await fs.rm(source, { recursive: true });
    }
    await fs.rm(dir, { recursive: true });
  }
  async transfer(
    sourceLoc: Location,
    destLoc: Location,
    mode: "copy" | "move",
    overwrite: boolean,
    job: Job,
    signal: AbortSignal,
  ) {
    const source = await this.paths.resolve(sourceLoc, "entry"),
      dest = await this.paths.resolve(destLoc, "create");
    validName(path.basename(dest));
    if (contained(source, dest) || contained(dest, source))
      throw new HttpError(400, "Source and destination must be separate paths.");
    await this.paths.assertTree(source, signal);
    if (await exists(dest)) {
      if (!overwrite) throw new HttpError(409, "Destination exists. Choose Replace or Cancel.");
      await this.trash(dest, destLoc, job, signal);
    }
    if (mode === "move") {
      try {
        await fs.rename(source, dest);
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      }
    }
    const staging = path.join(path.dirname(dest), `.harbor-part-${randomUUID()}`);
    try {
      await verifiedCopy(source, staging, job, signal);
      if (mode === "move") await verifyTree(source, staging, signal);
      signal.throwIfAborted();
      if (await exists(dest))
        throw new HttpError(409, "Destination appeared during transfer; source retained.");
      await fs.rename(staging, dest);
      if (mode === "move") {
        signal.throwIfAborted();
        await fs.rm(source, { recursive: true });
      }
    } catch (e) {
      await fs.rm(staging, { force: true, recursive: true });
      throw e;
    }
  }
}
