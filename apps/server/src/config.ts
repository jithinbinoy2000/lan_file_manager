import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";
export interface Config {
  host: string;
  port: number;
  allVolumes: boolean;
  roots: string[];
  dataDir: string;
  configPath?: string;
  maxUploadBytes: number;
  maxEntries: number;
  /** Plaintext access PIN, held only in memory; printed once at startup for LAN mode. Never persisted to disk. */
  lanPassword?: string;
  /** salt:hash of lanPassword, held only in memory for the life of this process. */
  passwordHash?: string;
}
export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString("hex");
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
export const dataDirectory = () => process.env.HARBOR_DATA_DIR || path.join(os.homedir(), ".harbor");
export function lanAddress(): string | undefined {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name] ?? []) if (net.family === "IPv4" && !net.internal) return net.address;
  return undefined;
}
const generatePin = () => String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
export async function loadConfig(args = process.argv.slice(2)): Promise<Config> {
  if (args.includes("--help")) {
    console.log(
      `Studio Files — local file manager\n\nnpm start -- [--host 127.0.0.1] [--port 3210] [--config /path/config.json]\nnpm start -- --lan [--password <pin>]\n\nDefault: all accessible volumes, no login, loopback only.\n--lan binds to this machine's LAN address and requires a PIN, freshly generated and printed\neach time the server starts (or set explicitly with --password). The PIN lives only in memory\nfor this run — it is never written to disk, and stops working as soon as the server stops.\nHARBOR_DATA_DIR selects configuration/trash storage (default ~/.harbor).\nConfig: { "host": "127.0.0.1", "port": 3210, "allVolumes": true, "roots": [], "maxUploadBytes": 10737418240 }\nOS permissions still apply. No automatic elevation.`,
    );
    process.exit(0);
  }
  const allowed = new Set(["--host", "--port", "--config", "--password"]);
  const boolFlags = new Set(["--lan"]);
  for (let i = 0; i < args.length; i++) {
    if (boolFlags.has(args[i])) continue;
    if (!allowed.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
    if (!args[i + 1]) throw new Error(`Missing value for ${args[i]}`);
    i++;
  }
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const lan = args.includes("--lan");
  const dataDir = path.resolve(dataDirectory());
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const configPath = arg("--config") || path.join(dataDir, "config.json");
  let user: Partial<Config> = {};
  try {
    user = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT" || arg("--config")) throw e;
  }
  const lanPassword = lan ? arg("--password") || generatePin() : undefined;
  const config: Config = {
    host: lan ? arg("--host") || lanAddress() || "0.0.0.0" : arg("--host") || user.host || "127.0.0.1",
    port: Number(arg("--port") || user.port || 3210),
    allVolumes: user.allVolumes ?? true,
    roots: user.roots ?? [],
    dataDir,
    configPath: path.resolve(configPath),
    maxUploadBytes: user.maxUploadBytes ?? 10 * 1024 ** 3,
    maxEntries: 50000,
    lanPassword,
    passwordHash: lanPassword ? hashPassword(lanPassword) : undefined,
  };
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(config.host);
  if (!loopback && !lan)
    throw new Error(
      "Binding beyond localhost requires --lan, which enables PIN authentication. No-login mode is localhost-only.",
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("Port must be between 1 and 65535.");
  if (typeof config.allVolumes !== "boolean") throw new Error("allVolumes must be a boolean.");
  if (!Array.isArray(config.roots) || config.roots.some((r) => typeof r !== "string" || !path.isAbsolute(r)))
    throw new Error("roots must contain absolute paths.");
  if (!Number.isSafeInteger(config.maxUploadBytes) || config.maxUploadBytes < 1)
    throw new Error("Invalid maxUploadBytes.");
  return config;
}
