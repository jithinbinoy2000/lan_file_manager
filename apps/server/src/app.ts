import express, { type Request, type Response, type NextFunction } from "express";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { ZipArchive } from "archiver";
import mime from "mime-types";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { verifyPassword, type Config } from "./config.js";
import { discoverVolumes } from "./volumes.js";
import { discoverShortcuts } from "./shortcuts.js";
import { Paths, HttpError, location, validName, contained } from "./paths.js";
import { Operations, exists } from "./operations.js";
import { Jobs } from "./jobs.js";
import type { Entry, Location, Job } from "../../../packages/shared/types.js";

export function parseRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2]) || !size) throw new HttpError(416, "Requested range is not satisfiable.");
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] ? (m[2] ? Math.min(Number(m[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start)
    throw new HttpError(416, "Requested range is not satisfiable.");
  return { start, end };
}
const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
export async function createApp(config: Config, { webDir = path.resolve("dist/web"), dev = false } = {}) {
  config.dataDir = await fs.realpath(config.dataDir);
  const app = express();
  app.disable("x-powered-by");
  app.set("json escape", true);
  const paths = new Paths(await discoverVolumes(config), config.dataDir),
    ops = new Operations(paths, path.join(config.dataDir, "trash")),
    jobs = new Jobs();
  const sessions = new Map<string, { csrf: string; expires: number }>();
  let mutating = false,
    thumbs = 0;
  const thumbQueue: Array<() => void> = [];
  const thumbnailSlot = async () => {
    if (thumbs < 2) {
      thumbs++;
      return;
    }
    if (thumbQueue.length >= 128) throw new HttpError(429, "Thumbnail queue is full.");
    await new Promise<void>((resolve) => thumbQueue.push(resolve));
  };
  const releaseThumbnail = () => {
    const next = thumbQueue.shift();
    if (next) next();
    else thumbs--;
  };
  const exclusive = async <T>(fn: () => Promise<T>) => {
    if (mutating) throw new HttpError(409, "Another file operation is in progress.");
    mutating = true;
    try {
      return await fn();
    } finally {
      mutating = false;
    }
  };
  const cache = new Map<string, { created: number; entries: Entry[] }>();
  const invalidate = () => cache.clear();
  const startJob = (type: string, total: number, fn: (job: Job, signal: AbortSignal) => Promise<void>) => {
    if (mutating) throw new HttpError(409, "Another file operation is in progress.");
    mutating = true;
    try {
      return jobs.start(type, total, async (j, s) => {
        try {
          await fn(j, s);
        } finally {
          mutating = false;
          invalidate();
        }
      });
    } catch (e) {
      mutating = false;
      throw e;
    }
  };
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", config.host]);
  app.use((req, res, next) => {
    const host = req.headers.host ?? "";
    const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (!allowedHosts.has(hostname)) return res.status(403).json({ error: "Unrecognized host." });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== `http://${host}` &&
      !(dev && ["http://127.0.0.1:5173", "http://localhost:5173"].includes(origin))
    )
      return res.status(403).json({ error: "Cross-origin access is blocked." });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return res.status(403).json({ error: "Cross-site access is blocked." });
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  const issueSession = (res: Response) => {
    const id = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    sessions.set(id, { csrf, expires: Date.now() + 12 * 3600e3 });
    res.cookie("harbor_session", id, { httpOnly: true, sameSite: "strict", maxAge: 12 * 3600e3, path: "/" });
    return csrf;
  };
  let loginAttempts: { count: number; resetAt: number } = { count: 0, resetAt: 0 };
  app.get("/api/session", (req, res) => {
    for (const [k, s] of sessions) if (s.expires < Date.now()) sessions.delete(k);
    const cookies = req.headers.cookie ?? "";
    const old = /\bharbor_session=([a-f0-9]+)/.exec(cookies)?.[1];
    if (old && sessions.has(old))
      return res.json({
        csrf: sessions.get(old)!.csrf,
        mode: "local",
        allVolumes: config.allVolumes,
        maxUploadBytes: config.maxUploadBytes,
      });
    if (config.passwordHash) return res.status(401).json({ error: "PIN required.", loginRequired: true });
    if (sessions.size >= 100) return res.status(429).json({ error: "Too many sessions." });
    const csrf = issueSession(res);
    res.json({ csrf, mode: "local", allVolumes: config.allVolumes, maxUploadBytes: config.maxUploadBytes });
  });
  app.post("/api/session", (req, res) => {
    if (!config.passwordHash) return res.status(400).json({ error: "PIN login is not enabled." });
    if (Date.now() > loginAttempts.resetAt) loginAttempts = { count: 0, resetAt: Date.now() + 60_000 };
    if (loginAttempts.count >= 10)
      return res.status(429).json({ error: "Too many attempts. Try again shortly." });
    loginAttempts.count++;
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!password || !verifyPassword(password, config.passwordHash))
      return res.status(401).json({ error: "Incorrect PIN." });
    if (sessions.size >= 100) return res.status(429).json({ error: "Too many sessions." });
    const csrf = issueSession(res);
    res.json({ csrf, mode: "local", allVolumes: config.allVolumes, maxUploadBytes: config.maxUploadBytes });
  });
  app.use("/api", (req, res, next) => {
    const id = /\bharbor_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
    const session = id ? sessions.get(id) : undefined;
    if (!session || session.expires < Date.now())
      return res.status(401).json({ error: "Session expired. Reload the page." });
    if (!["GET", "HEAD"].includes(req.method) && req.headers["x-csrf-token"] !== session.csrf)
      return res.status(403).json({ error: "Invalid request token. Reload the page." });
    next();
  });
  app.get(
    "/api/volumes",
    asyncRoute(async (_req, res) => {
      paths.volumes = await discoverVolumes(config);
      res.json({
        volumes: paths.volumes,
        shortcuts: await discoverShortcuts(paths.volumes, config.dataDir),
        allVolumes: config.allVolumes,
        platform: process.platform,
      });
    }),
  );
  app.post(
    "/api/settings",
    asyncRoute(async (req, res) => {
      if (typeof req.body.allVolumes !== "boolean") throw new HttpError(400, "allVolumes must be a boolean.");
      await exclusive(async () => {
        const next = { ...config, allVolumes: req.body.allVolumes };
        if (!next.allVolumes && !next.roots.length) {
          const home = paths.volumes.find((v) => v.kind === "home");
          if (home) next.roots = [home.path];
        }
        const volumes = await discoverVolumes(next);
        const filename = config.configPath || path.join(config.dataDir, "config.json");
        const temporary = filename + ".tmp";
        try {
          await fs.writeFile(
            temporary,
            JSON.stringify(
              {
                host: next.host,
                port: next.port,
                allVolumes: next.allVolumes,
                roots: next.roots,
                maxUploadBytes: next.maxUploadBytes,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
          await fs.rename(temporary, filename);
        } finally {
          await fs.rm(temporary, { force: true });
        }
        config.allVolumes = next.allVolumes;
        config.roots = next.roots;
        paths.volumes = volumes;
        invalidate();
      });
      res.json({
        volumes: paths.volumes,
        shortcuts: await discoverShortcuts(paths.volumes, config.dataDir),
        allVolumes: config.allVolumes,
        platform: process.platform,
      });
    }),
  );
  app.get(
    "/api/list",
    asyncRoute(async (req, res) => {
      const loc = location(req.query.root, req.query.path),
        dir = await paths.resolve(loc);
      const showHidden = req.query.hidden === "true";
      const key = JSON.stringify(loc);
      let cached = cache.get(key);
      if (req.query.refresh === "true") {
        cache.delete(key);
        cached = undefined;
      }
      if (!cached || Date.now() - cached.created > 15000) {
        const entries: Entry[] = [];
        let scanned = 0;
        for await (const d of await fs.opendir(dir)) {
          if (++scanned > config.maxEntries)
            throw new HttpError(
              413,
              `This folder exceeds ${config.maxEntries.toLocaleString()} entries. Open a narrower directory.`,
            );
          if (d.name.startsWith(".harbor-part-") || contained(config.dataDir, path.join(dir, d.name)))
            continue;
          try {
            const stat = await fs.lstat(path.join(dir, d.name));
            entries.push({
              name: d.name,
              path: [loc.path, d.name].filter(Boolean).join("/"),
              kind: stat.isSymbolicLink()
                ? "symlink"
                : stat.isDirectory()
                  ? "directory"
                  : stat.isFile()
                    ? "file"
                    : "other",
              size: stat.size,
              modified: stat.mtimeMs,
              mime: mime.lookup(d.name) || "application/octet-stream",
              hidden: d.name.startsWith("."),
            });
          } catch {
            /* Concurrently removed or unreadable entry. */
          }
        }
        cached = { created: Date.now(), entries };
        if (cache.size >= 8) cache.delete(cache.keys().next().value!);
        cache.set(key, cached);
      }
      const q = String(req.query.q ?? "").toLocaleLowerCase();
      const sort = String(req.query.sort ?? "name"),
        direction = req.query.direction === "desc" ? -1 : 1;
      const entries = cached.entries
        .filter((e) => (showHidden || !e.hidden) && e.name.toLocaleLowerCase().includes(q))
        .sort((a, b) => {
          if (a.kind === "directory" && b.kind !== "directory") return -1;
          if (b.kind === "directory" && a.kind !== "directory") return 1;
          return (
            direction *
            (sort === "size"
              ? a.size - b.size
              : sort === "modified"
                ? a.modified - b.modified
                : a.name.localeCompare(b.name, undefined, { numeric: true }))
          );
        });
      const offset = Math.max(0, Number(req.query.offset) || 0),
        limit = 200;
      res.json({
        entries: entries.slice(offset, offset + limit),
        total: entries.length,
        next: offset + limit < entries.length ? offset + limit : null,
        root: paths.volume(loc.root),
        path: loc.path,
      });
    }),
  );
  app.get(
    "/api/stat",
    asyncRoute(async (req, res) => {
      const p = await paths.resolve(location(req.query.root, req.query.path)),
        s = await fs.stat(p);
      res.json({
        kind: s.isDirectory() ? "directory" : s.isFile() ? "file" : "other",
        size: s.size,
        modified: s.mtimeMs,
      });
    }),
  );
  app.get(
    "/api/file",
    asyncRoute(async (req, res) => {
      const file = await paths.resolve(location(req.query.root, req.query.path));
      const handle = await fs.open(file, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new HttpError(400, "Only regular files can be streamed.");
        const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
        res.set({
          "Accept-Ranges": "bytes",
          ETag: etag,
          "Last-Modified": stat.mtime.toUTCString(),
          "Cache-Control": "private, no-cache",
        });
        if (req.headers["if-none-match"] === etag) {
          res.status(304).end();
          return;
        }
        const type = mime.lookup(file) || "application/octet-stream";
        const safe = /^(image\/(png|jpeg|gif|webp|avif|bmp)|audio\/|video\/)/.test(type);
        const download = req.query.download === "true" || !safe;
        if (req.query.transcode === "true" && type.startsWith("video/") && !download) {
          const executable =
            typeof ffmpegPath === "string"
              ? ffmpegPath
              : (ffmpegPath as unknown as { default?: string | null }).default;
          if (!executable) throw new HttpError(503, "Bundled FFmpeg is unavailable.");
          res.status(200).set({
            "Content-Type": "video/mp4",
            "Cache-Control": "private, no-store",
            "Accept-Ranges": "none",
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file)).replace(/'/g, "%27")}`,
          });
          const encoder = spawn(executable, [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            file,
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "-f",
            "mp4",
            "pipe:1",
          ], { stdio: ["ignore", "pipe", "pipe"] });
          const stop = () => {
            if (!encoder.killed) encoder.kill();
          };
          res.on("close", stop);
          encoder.stdout.pipe(res);
          await new Promise<void>((resolve, reject) => {
            encoder.once("error", reject);
            encoder.once("close", (code) => (code === 0 ? resolve() : reject(new Error("FFmpeg could not decode this video."))));
          }).finally(() => res.off("close", stop));
          return;
        }
        res.setHeader("Content-Type", safe ? type : "application/octet-stream");
        res.setHeader(
          "Content-Disposition",
          `${download ? "attachment" : "inline"}; filename="download"; filename*=UTF-8''${encodeURIComponent(path.basename(file)).replace(/'/g, "%27")}`,
        );
        let range;
        try {
          range = parseRange(
            !req.headers["if-range"] || req.headers["if-range"] === etag ? req.headers.range : undefined,
            stat.size,
          );
        } catch (e) {
          res.setHeader("Content-Range", `bytes */${stat.size}`);
          throw e;
        }
        res.status(range ? 206 : 200);
        res.setHeader("Content-Length", range ? range.end - range.start + 1 : stat.size);
        if (range) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        const stream = handle.createReadStream({ ...range, autoClose: false });
        res.on("close", () => stream.destroy());
        await pipeline(stream, res).catch((e) => {
          if (!res.destroyed) throw e;
        });
      } finally {
        await handle.close();
      }
    }),
  );
  app.get(
    "/api/thumbnail",
    asyncRoute(async (req, res) => {
      const file = await paths.resolve(location(req.query.root, req.query.path)),
        stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 80 * 1024 ** 2 || !/\.(png|jpe?g|webp|avif|gif|tiff?)$/i.test(file))
        throw new HttpError(415, "Thumbnail unavailable.");
      await thumbnailSlot();
      try {
        if (res.destroyed) return;
        res.type("image/webp");
        res.setHeader("Cache-Control", "private, max-age=60");
        const data = await sharp(file, { limitInputPixels: 40000000, animated: false })
          .rotate()
          .resize(480, 320, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer();
        res.send(data);
      } finally {
        releaseThumbnail();
      }
    }),
  );
  app.get(
    "/api/archive",
    asyncRoute(async (req, res) => {
      const dir = await paths.resolve(location(req.query.root, req.query.path));
      await paths.assertTree(dir);
      res.attachment(`${path.basename(dir) || "files"}.zip`);
      const zip = new ZipArchive({ zlib: { level: 1 } });
      zip.on("error", () => res.destroy());
      res.on("close", () => zip.abort());
      zip.pipe(res);
      zip.directory(dir, path.basename(dir) || "files");
      await zip.finalize();
    }),
  );
  app.post(
    "/api/mkdir",
    asyncRoute(async (req, res) => {
      if (mutating) throw new HttpError(409, "Another file operation is in progress.");
      validName(req.body.name);
      const loc = location(req.body.root, [req.body.path, req.body.name].filter(Boolean).join("/"));
      await exclusive(async () => fs.mkdir(await paths.resolve(loc, "create")));
      invalidate();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/rename",
    asyncRoute(async (req, res) => {
      if (mutating) throw new HttpError(409, "Another file operation is in progress.");
      validName(req.body.name);
      const from = location(req.body.root, req.body.path),
        p = await paths.resolve(from, "entry"),
        destLoc = { root: from.root, path: [...from.path.split("/").slice(0, -1), req.body.name].join("/") },
        to = await paths.resolve(destLoc, "create");
      await exclusive(async () => {
        if (await exists(to)) throw new HttpError(409, "An item with this name already exists.");
        await fs.rename(p, to);
      });
      invalidate();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/transfer",
    asyncRoute(async (req, res) => {
      const { items, destination, mode, overwrite } = req.body as {
        items: Location[];
        destination: Location;
        mode: string;
        overwrite: boolean;
      };
      if (!Array.isArray(items) || !items.length || items.length > 200 || !["copy", "move"].includes(mode))
        throw new HttpError(400, "Select 1–200 items to copy or move.");
      await paths.resolve(destination);
      for (const item of items) {
        await paths.resolve(item, "entry");
        const target = {
          root: destination.root,
          path: [destination.path, path.posix.basename(item.path)].filter(Boolean).join("/"),
        };
        if (!overwrite && (await exists(await paths.resolve(target, "create"))))
          throw new HttpError(
            409,
            "One or more names already exist. Replace moves the existing items to Harbor trash first.",
          );
      }
      const job = startJob(mode, items.length, async (j, s) => {
        for (const item of items) {
          s.throwIfAborted();
          j.message = path.posix.basename(item.path);
          await ops.transfer(
            item,
            {
              root: destination.root,
              path: [destination.path, path.posix.basename(item.path)].filter(Boolean).join("/"),
            },
            mode as "copy" | "move",
            !!overwrite,
            j,
            s,
          );
          j.completed++;
        }
      });
      res.status(202).json(job);
    }),
  );
  app.post(
    "/api/delete",
    asyncRoute(async (req, res) => {
      const items = req.body.items as Location[];
      if (!Array.isArray(items) || !items.length || items.length > 200)
        throw new HttpError(400, "Select 1–200 items.");
      if (req.body.permanent !== true && req.body.permanent !== false)
        throw new HttpError(400, "Choose trash or permanent deletion.");
      for (const item of items) await paths.resolve(item, "entry");
      res.status(202).json(
        startJob(req.body.permanent ? "Delete permanently" : "Move to trash", items.length, async (j, s) => {
          for (const item of items) {
            s.throwIfAborted();
            const p = await paths.resolve(item, "entry");
            j.message = path.basename(p);
            if (req.body.permanent) await fs.rm(p, { recursive: true });
            else await ops.trash(p, item, j, s);
            j.completed++;
          }
        }),
      );
    }),
  );
  app.get(
    "/api/trash",
    asyncRoute(async (_req, res) => res.json(await ops.trashList())),
  );
  app.post(
    "/api/restore",
    asyncRoute(async (req, res) =>
      res.status(202).json(
        startJob("Restore", 1, async (j, s) => {
          await ops.restore(String(req.body.id), j, s);
          j.completed = 1;
        }),
      ),
    ),
  );
  app.get("/api/jobs", (_req, res) => res.json(jobs.list()));
  app.post("/api/jobs/:id/cancel", (req, res, next) => {
    try {
      jobs.cancel(String(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/api/size",
    asyncRoute(async (req, res) => {
      const p = await paths.resolve(location(req.body.root, req.body.path));
      res.status(202).json(
        startJob("Calculate size", 1, async (j, s) => {
          let count = 0,
            total = 0;
          const walk = async (file: string) => {
            s.throwIfAborted();
            if (++count > 100000) throw new HttpError(413, "Size scan exceeds 100,000 entries.");
            if (contained(config.dataDir, file)) return;
            const st = await fs.lstat(file);
            if (st.isDirectory()) {
              for await (const e of await fs.opendir(file)) await walk(path.join(file, e.name));
            } else if (st.isFile()) total += st.size;
            j.bytes = total;
            j.message = `${count.toLocaleString()} entries scanned`;
          };
          await walk(p);
          j.result = { size: total, count };
          j.completed = 1;
        }),
      );
    }),
  );
  app.post(
    "/api/upload",
    asyncRoute(async (req, res) => {
      if (mutating) throw new HttpError(409, "Another file operation is in progress.");
      const parent = location(req.query.root, req.query.path);
      mutating = true;
      let dir: string;
      try {
        dir = await paths.resolve(parent);
      } catch (e) {
        mutating = false;
        throw e;
      }
      const temp = path.join(dir, `.harbor-part-${randomUUID()}`);
      let name = "",
        count = 0,
        limited = false;
      let write: Promise<void> | undefined;
      const controller = new AbortController();
      req.on("aborted", () => controller.abort());
      try {
        await new Promise<void>((resolve, reject) => {
          const parser = Busboy({
            headers: req.headers,
            limits: { files: 1, fileSize: config.maxUploadBytes, fields: 0, parts: 2 },
          });
          parser.on("file", (_field, stream, info) => {
            count++;
            try {
              validName(info.filename);
              name = info.filename;
            } catch (e) {
              stream.resume();
              reject(e);
              return;
            }
            stream.on("limit", () => {
              limited = true;
            });
            write = pipeline(stream, createWriteStream(temp, { flags: "wx", mode: 0o600 }), {
              signal: controller.signal,
            });
            write.catch(reject);
          });
          parser.on("partsLimit", () =>
            reject(new HttpError(400, "Upload exactly one file and no extra fields.")),
          );
          parser.on("fieldsLimit", () => reject(new HttpError(400, "Unexpected upload fields.")));
          parser.on("filesLimit", () => reject(new HttpError(400, "Upload one file at a time.")));
          parser.on("error", reject);
          req.on("aborted", () => reject(new HttpError(400, "Upload cancelled.")));
          parser.on("close", resolve);
          req.pipe(parser);
        });
        await write;
        if (count !== 1) throw new HttpError(400, "Choose a file.");
        if (limited) throw new HttpError(413, "File exceeds the configured upload limit.");
        const destLoc = { root: parent.root, path: [parent.path, name].filter(Boolean).join("/") },
          dest = await paths.resolve(destLoc, "create");
        if (await exists(dest)) {
          if (req.query.overwrite !== "true")
            throw new HttpError(409, "This name already exists. Choose Replace or Cancel.");
          const dummy: Job = {
            id: "upload",
            type: "upload",
            status: "running",
            completed: 0,
            total: 1,
            bytes: 0,
            message: name,
          };
          await ops.trash(dest, destLoc, dummy, controller.signal);
        }
        await fs.rename(temp, dest);
        invalidate();
        res.json({ ok: true });
      } finally {
        controller.abort();
        await write?.catch(() => {});
        await fs.rm(temp, { force: true });
        mutating = false;
      }
    }),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
  app.use(express.static(webDir, { index: false }));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(webDir, "index.html")));
  app.use(
    (err: NodeJS.ErrnoException & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const map: Record<string, [number, string]> = {
        ENOENT: [404, "The item no longer exists or the drive is disconnected."],
        EACCES: [403, "Access denied by the operating system."],
        EPERM: [403, "The operating system does not permit this action."],
        EEXIST: [409, "An item with this name already exists."],
        ENOTDIR: [400, "This item is not a folder."],
        ENOSPC: [507, "The destination has insufficient free space."],
        EBUSY: [409, "This item is being used by another application."],
      };
      const mapped = map[err.code ?? ""];
      res.status(mapped?.[0] ?? err.status ?? 500).json({
        error:
          mapped?.[1] ??
          (err instanceof HttpError
            ? err.message
            : "The operation could not be completed. Check permissions and drive availability."),
      });
    },
  );
  return { app, paths, jobs };
}
