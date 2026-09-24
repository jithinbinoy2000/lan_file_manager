import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import sharp from "sharp";
import { createApp, parseRange } from "../src/app.js";
import { contained, validName, Paths } from "../src/paths.js";
import { parseMounts, discoverVolumes } from "../src/volumes.js";
import { loadConfig, hashPassword, verifyPassword, type Config } from "../src/config.js";
import { verifiedCopy } from "../src/operations.js";
import type { Job, Volume } from "../../../packages/shared/types.js";
let sandbox: string,
  root: string,
  outside: string,
  config: Config,
  server: Server,
  base: string,
  cookie: string,
  csrf: string,
  volume: Volume;
const req = async (route: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json", "x-csrf-token": csrf }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const q = (p = "") => `root=${volume.id}&path=${encodeURIComponent(p)}`;
async function finished(id: string) {
  for (let i = 0; i < 100; i++) {
    const jobs = (await (await req("/api/jobs")).json()) as Job[];
    const j = jobs.find((j) => j.id === id)!;
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Job timeout");
}
before(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "studio-files-test-"));
  root = path.join(sandbox, "root");
  outside = path.join(sandbox, "outside");
  const dataDir = path.join(sandbox, "private");
  await Promise.all([fs.mkdir(root), fs.mkdir(outside), fs.mkdir(dataDir)]);
  config = {
    host: "127.0.0.1",
    port: 3210,
    allVolumes: false,
    roots: [root],
    dataDir,
    maxUploadBytes: 1024 * 1024,
    maxEntries: 50000,
  };
  await fs.writeFile(path.join(root, "sample.txt"), "0123456789");
  await fs.writeFile(path.join(root, ".hidden"), "hidden");
  await fs.writeFile(path.join(root, "攻撃.html"), "<script>alert(1)</script>");
  await fs.writeFile(path.join(outside, "secret.txt"), "private");
  await fs.symlink(outside, path.join(root, "escape"));
  const made = await createApp(config);
  server = made.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const session = await fetch(base + "/api/session");
  cookie = session.headers.get("set-cookie")!.split(";")[0];
  csrf = (await session.json()).csrf;
  volume = (await (await req("/api/volumes")).json()).volumes[0];
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(sandbox, { recursive: true, force: true });
});
test("containment, portable names and mount decoding", () => {
  assert.equal(contained("/data", "/data-backup"), false);
  assert.equal(contained("/data", "/data/x"), true);
  for (const name of ["..", "../x", "a/b", "a\\b", "CON", "a.", "x\0"]) assert.throws(() => validName(name));
  validName("旅行 notes 🪴.txt");
  assert.deepEqual(
    parseMounts(
      "1 2 3 4 / rw - ext4 dev rw\n1 2 3 4 /media/My\\040Disk rw - ext4 dev rw\n1 2 3 4 /proc rw - proc proc rw",
    ),
    ["/", "/media/My Disk"],
  );
});
test("volume discovery only exposes explicitly configured accessible directories", async () => {
  const roots = await discoverVolumes({
    ...config,
    roots: [root, path.join(root, "sample.txt"), path.join(sandbox, "missing")],
  });
  assert.equal(roots.length, 1);
  assert.equal(roots[0].path, root);
});
test("session and CSRF are required for API access", async () => {
  assert.equal((await fetch(base + "/api/volumes")).status, 401);
  assert.equal(
    (await req("/api/mkdir", { root: volume.id, path: "", name: "bad" }, { "x-csrf-token": "bad" })).status,
    403,
  );
  assert.equal((await req("/api/volumes", undefined, { origin: "https://evil.example" })).status, 403);
  const badHost = await new Promise<number>((resolve) => {
    const r = httpRequest(base + "/api/session", { headers: { host: "evil.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    r.end();
  });
  assert.equal(badHost, 403);
});
test("no-login config refuses LAN binding", async () => {
  const original = process.env.HARBOR_DATA_DIR;
  process.env.HARBOR_DATA_DIR = config.dataDir;
  try {
    await assert.rejects(loadConfig(["--host", "0.0.0.0"]), /localhost-only/);
  } finally {
    if (original === undefined) delete process.env.HARBOR_DATA_DIR;
    else process.env.HARBOR_DATA_DIR = original;
  }
});
test("--lan generates a fresh in-memory PIN per run and never persists it", async () => {
  const dataDir = path.join(sandbox, "lan-config");
  await fs.mkdir(dataDir);
  const original = process.env.HARBOR_DATA_DIR;
  process.env.HARBOR_DATA_DIR = dataDir;
  try {
    const explicit = await loadConfig(["--lan", "--password", "correct horse battery staple"]);
    assert.ok(explicit.passwordHash);
    assert.equal(explicit.lanPassword, "correct horse battery staple");
    assert.notEqual(explicit.host, "127.0.0.1");
    const configOnDisk = await fs
      .readFile(path.join(dataDir, "config.json"), "utf8")
      .catch(() => undefined);
    if (configOnDisk) assert.ok(!JSON.parse(configOnDisk).passwordHash);
    const first = await loadConfig(["--lan"]);
    const second = await loadConfig(["--lan"]);
    assert.ok(first.lanPassword && second.lanPassword);
    assert.notEqual(first.lanPassword, second.lanPassword);
    assert.notEqual(first.passwordHash, second.passwordHash);
  } finally {
    if (original === undefined) delete process.env.HARBOR_DATA_DIR;
    else process.env.HARBOR_DATA_DIR = original;
  }
});
test("password hashing verifies correct passwords and rejects wrong ones", () => {
  const hash = hashPassword("hunter2");
  assert.ok(verifyPassword("hunter2", hash));
  assert.ok(!verifyPassword("wrong", hash));
  assert.ok(!verifyPassword("hunter2", "not:areal-hash-format"));
});
test("LAN-mode session endpoint requires a password before issuing a cookie", async () => {
  const dataDir = path.join(sandbox, "lan-app");
  await fs.mkdir(dataDir);
  const lanConfig: Config = {
    ...config,
    dataDir,
    configPath: path.join(dataDir, "config.json"),
    passwordHash: hashPassword("s3cret"),
  };
  const made = await createApp(lanConfig);
  const lanServer = made.app.listen(0, "127.0.0.1");
  await once(lanServer, "listening");
  const lanBase = `http://127.0.0.1:${(lanServer.address() as { port: number }).port}`;
  try {
    const anon = await fetch(lanBase + "/api/session");
    assert.equal(anon.status, 401);
    assert.equal((await anon.json()).loginRequired, true);
    const wrong = await fetch(lanBase + "/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    assert.equal(wrong.status, 401);
    const right = await fetch(lanBase + "/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "s3cret" }),
    });
    assert.equal(right.status, 200);
    const lanCookie = right.headers.get("set-cookie")!.split(";")[0];
    const volumes = await fetch(lanBase + "/api/volumes", { headers: { cookie: lanCookie } });
    assert.equal(volumes.status, 200);
  } finally {
    lanServer.closeAllConnections();
    await new Promise<void>((resolve) => lanServer.close(() => resolve()));
  }
});
test("listing supports hidden, search, pagination and Unicode", async () => {
  const list = await (await req(`/api/list?${q()}`)).json();
  assert.ok(list.entries.some((e: { name: string }) => e.name === "攻撃.html"));
  assert.ok(!list.entries.some((e: { name: string }) => e.name === ".hidden"));
  const hidden = await (await req(`/api/list?${q()}&hidden=true&q=hidden`)).json();
  assert.equal(hidden.entries.length, 1);
  assert.equal(hidden.entries[0].name, ".hidden");
});
test("rejects traversal, symlink escape and private storage aliases", async () => {
  assert.equal((await req(`/api/list?${q("../outside")}`)).status, 403);
  assert.equal((await req(`/api/file?${q("escape/secret.txt")}`)).status, 403);
  await fs.symlink(config.dataDir, path.join(root, "private-link"));
  assert.equal((await req(`/api/list?${q("private-link")}`)).status, 403);
  assert.equal((await req(`/api/list?${q("/etc")}`)).status, 403);
});
test("streaming supports bounded, suffix, open ranges, HEAD, ETag and 416", async () => {
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  for (const [range, value] of [
    ["bytes=2-5", "2345"],
    ["bytes=-3", "789"],
    ["bytes=7-", "789"],
  ]) {
    const r = await req(`/api/file?${q("sample.txt")}`, undefined, { range });
    assert.equal(r.status, 206);
    assert.equal(await r.text(), value);
    assert.ok(r.headers.get("content-range"));
  }
  const full = await req(`/api/file?${q("sample.txt")}`);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), "0123456789");
  assert.equal(
    (await req(`/api/file?${q("sample.txt")}`, undefined, { "if-none-match": full.headers.get("etag")! }))
      .status,
    304,
  );
  const head = await fetch(base + `/api/file?${q("sample.txt")}`, { method: "HEAD", headers: { cookie } });
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");
  for (const range of ["bytes=20-", "bytes=5-2", "bytes=0-1,3-4", "bytes=-0"]) {
    const r = await req(`/api/file?${q("sample.txt")}`, undefined, { range });
    assert.equal(r.status, 416);
    assert.equal(r.headers.get("content-range"), "bytes */10");
  }
});
test("active HTML is always an attachment and errors do not leak full paths", async () => {
  const html = await req(`/api/file?${q("攻撃.html")}`);
  assert.match(html.headers.get("content-type")!, /application\/octet-stream/);
  assert.match(html.headers.get("content-disposition")!, /^attachment/);
  const missing = await req(`/api/file?${q("missing.txt")}`);
  assert.equal(missing.status, 404);
  assert.ok(!(await missing.text()).includes(root));
});
test("CRUD, copy conflict, move, trash restore and permanent deletion", async () => {
  assert.equal((await req("/api/mkdir", { root: volume.id, path: "", name: "旅行" })).status, 200);
  assert.equal((await req("/api/mkdir", { root: volume.id, path: "", name: "旅行" })).status, 409);
  assert.equal(
    (await req("/api/rename", { root: volume.id, path: "旅行", name: "Destination" })).status,
    200,
  );
  const transfer = {
    items: [{ root: volume.id, path: "sample.txt" }],
    destination: { root: volume.id, path: "Destination" },
    mode: "copy",
  };
  let r = await req("/api/transfer", transfer);
  assert.equal(r.status, 202);
  assert.equal((await finished((await r.json()).id)).status, "done");
  assert.equal(await fs.readFile(path.join(root, "Destination/sample.txt"), "utf8"), "0123456789");
  assert.equal((await req("/api/transfer", transfer)).status, 409);
  r = await req("/api/transfer", { ...transfer, overwrite: true });
  assert.equal((await finished((await r.json()).id)).status, "done");
  await req("/api/rename", { root: volume.id, path: "Destination/sample.txt", name: "moved.txt" });
  r = await req("/api/transfer", {
    items: [{ root: volume.id, path: "Destination/moved.txt" }],
    destination: { root: volume.id, path: "" },
    mode: "move",
  });
  assert.equal((await finished((await r.json()).id)).status, "done");
  r = await req("/api/delete", { items: [{ root: volume.id, path: "moved.txt" }], permanent: false });
  assert.equal((await finished((await r.json()).id)).status, "done");
  const trash = await (await req("/api/trash")).json();
  const deleted = trash.find((e: { name: string }) => e.name === "moved.txt");
  assert.ok(deleted);
  r = await req("/api/restore", { id: deleted.id });
  assert.equal((await finished((await r.json()).id)).status, "done");
  assert.equal(await fs.readFile(path.join(root, "moved.txt"), "utf8"), "0123456789");
  r = await req("/api/delete", { items: [{ root: volume.id, path: "moved.txt" }], permanent: true });
  assert.equal((await finished((await r.json()).id)).status, "done");
  await assert.rejects(fs.stat(path.join(root, "moved.txt")));
  assert.equal(
    (await req("/api/delete", { items: [{ root: volume.id, path: "" }], permanent: true })).status,
    403,
  );
});
test("upload streams content, handles conflicts and rejects oversized files", async () => {
  const send = (name: string, data: string) => {
    const form = new FormData();
    form.append("file", new Blob([data]), name);
    return fetch(base + `/api/upload?${q()}`, {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrf },
      body: form,
    });
  };
  assert.equal((await send("upload.txt", "upload content")).status, 200);
  assert.equal(await fs.readFile(path.join(root, "upload.txt"), "utf8"), "upload content");
  assert.equal((await send("upload.txt", "different")).status, 409);
  assert.equal(await fs.readFile(path.join(root, "upload.txt"), "utf8"), "upload content");
  assert.equal((await send("large.txt", "x".repeat(config.maxUploadBytes + 10))).status, 413);
  assert.ok(!(await fs.readdir(root)).some((n) => n.startsWith(".harbor-part-")));
});
test("thumbnails and ZIP downloads", async () => {
  await sharp({ create: { width: 40, height: 30, channels: 3, background: "#88aa55" } })
    .png()
    .toFile(path.join(root, "image.png"));
  const r = await req(`/api/thumbnail?${q("image.png")}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/webp");
  const b = Buffer.from(await r.arrayBuffer());
  assert.equal(b.subarray(8, 12).toString(), "WEBP");
  const zip = await req(`/api/archive?${q("Destination")}`);
  assert.equal(zip.status, 200);
  assert.equal(
    Buffer.from(await zip.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    "PK",
  );
});
test("verified copy preserves bytes and honours cancellation", async () => {
  const job: Job = {
    id: "test",
    type: "copy",
    status: "running",
    completed: 0,
    total: 1,
    bytes: 0,
    message: "",
  };
  const dest = path.join(root, "verified.txt");
  await verifiedCopy(path.join(root, "sample.txt"), dest, job, new AbortController().signal);
  assert.equal(await fs.readFile(dest, "utf8"), "0123456789");
  assert.equal(job.bytes, 10);
  const c = new AbortController();
  c.abort();
  await assert.rejects(verifiedCopy(dest, path.join(root, "cancelled.txt"), job, c.signal));
});
test("selected roots enforce both reads and mutations", async () => {
  const resolver = new Paths([volume], config.dataDir);
  await assert.rejects(resolver.resolve({ root: "missing", path: "" }), /Volume unavailable/);
  await assert.rejects(resolver.resolve({ root: volume.id, path: "escape/x" }, "create"), /outside/);
});

test("cross-volume move fallback verifies before deleting the source (simulated EXDEV)", async (t) => {
  const { Operations } = await import("../src/operations.js");
  const resolver = new Paths([volume], config.dataDir),
    operations = new Operations(resolver, path.join(config.dataDir, "trash"));
  const source = path.join(root, "cross-source"),
    dest = path.join(root, "cross-destination");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "nested.txt"), "cross-volume content");
  const original = fs.rename;
  const mocked = t.mock.method(
    fs,
    "rename",
    async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      if (
        String(from) === (await fs.realpath(source).catch(() => source)) &&
        String(to).endsWith("cross-destination")
      )
        throw Object.assign(new Error("cross device"), { code: "EXDEV" });
      return original(from, to);
    },
  );
  try {
    const job: Job = {
      id: "cross",
      type: "move",
      status: "running",
      completed: 0,
      total: 1,
      bytes: 0,
      message: "",
    };
    await operations.transfer(
      { root: volume.id, path: "cross-source" },
      { root: volume.id, path: "cross-destination" },
      "move",
      false,
      job,
      new AbortController().signal,
    );
    assert.equal(await fs.readFile(path.join(dest, "nested.txt"), "utf8"), "cross-volume content");
    await assert.rejects(fs.stat(source));
    assert.ok(job.bytes > 0);
  } finally {
    mocked.mock.restore();
  }
});

test("verification detects a changed source before cross-volume removal", async () => {
  const { verifyTree } = await import("../src/operations.js");
  const a = path.join(root, "verify-a"),
    b = path.join(root, "verify-b");
  await fs.writeFile(a, "original");
  await fs.writeFile(b, "changed!");
  await assert.rejects(verifyTree(a, b, new AbortController().signal), /Source changed/);
  assert.equal(await fs.readFile(a, "utf8"), "original");
});

test("upload rejects multiple files, leaving no partial outputs", async () => {
  const form = new FormData();
  form.append("file", new Blob(["a"]), "first.txt");
  form.append("file", new Blob(["b"]), "second.txt");
  const result = await fetch(base + `/api/upload?${q()}`, {
    method: "POST",
    headers: { cookie, "x-csrf-token": csrf },
    body: form,
  });
  assert.equal(result.status, 400);
  assert.ok(!(await fs.readdir(root)).some((n) => n.startsWith(".harbor-part-")));
});

test("large listings paginate with stable sorting and cancellation routes reject missing jobs", async () => {
  const dir = path.join(root, "pagination");
  await fs.mkdir(dir);
  await Promise.all(
    Array.from({ length: 215 }, (_, i) =>
      fs.writeFile(path.join(dir, `item-${String(i).padStart(3, "0")}.txt`), "x"),
    ),
  );
  const first = await (await req(`/api/list?${q("pagination")}`)).json();
  assert.equal(first.entries.length, 200);
  assert.equal(first.next, 200);
  const second = await (await req(`/api/list?${q("pagination")}&offset=200`)).json();
  assert.equal(second.entries.length, 15);
  assert.equal(second.next, null);
  assert.equal((await req("/api/jobs/missing/cancel", {})).status, 404);
});

test("copying a read-only tree preserves file content and permissions", async () => {
  const source = path.join(root, "readonly-source"),
    dest = path.join(root, "readonly-copy");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "locked.txt"), "readable");
  await fs.chmod(path.join(source, "locked.txt"), 0o444);
  await fs.chmod(source, 0o555);
  const job: Job = {
    id: "readonly",
    type: "copy",
    status: "running",
    completed: 0,
    total: 1,
    bytes: 0,
    message: "",
  };
  try {
    await verifiedCopy(source, dest, job, new AbortController().signal);
    assert.equal(await fs.readFile(path.join(dest, "locked.txt"), "utf8"), "readable");
    if (process.platform !== "win32")
      assert.equal((await fs.stat(path.join(dest, "locked.txt"))).mode & 0o777, 0o444);
  } finally {
    await fs.chmod(source, 0o755);
    await fs.chmod(dest, 0o755).catch(() => {});
  }
});

test("shortcuts never invent Downloads under an unrelated configured root", async () => {
  const { discoverShortcuts } = await import("../src/shortcuts.js");
  const fakeHome = path.join(sandbox, "shortcut-home");
  await fs.mkdir(fakeHome);
  await fs.mkdir(path.join(fakeHome, "Downloads"));
  const unrelated = await discoverShortcuts([volume], config.dataDir, fakeHome);
  assert.deepEqual(unrelated, []);
  const homeVolume: Volume = { id: "home-shortcut", name: "Home", path: fakeHome, kind: "home" };
  const valid = await discoverShortcuts([homeVolume], config.dataDir, fakeHome);
  assert.deepEqual(
    valid.map((s) => s.id),
    ["home", "downloads"],
  );
  assert.deepEqual(
    valid.find((s) => s.id === "downloads"),
    { id: "downloads", name: "Downloads", root: "home-shortcut", path: "Downloads" },
  );
  for (const shortcut of valid) assert.ok((await fs.stat(path.join(fakeHome, shortcut.path))).isDirectory());
});

test("volume API returns only verified shortcuts within its allowed roots", async () => {
  const result = await (await req("/api/volumes")).json();
  assert.ok(Array.isArray(result.shortcuts));
  // The restricted fixture root is not the operating system home directory.
  assert.deepEqual(result.shortcuts, []);
});
