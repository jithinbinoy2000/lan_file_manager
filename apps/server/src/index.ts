import { lanAddress, loadConfig } from "./config.js";
import { createApp } from "./app.js";
import qrcode from "qrcode-terminal";
try {
  const config = await loadConfig();
  const { app } = await createApp(config, { dev: process.argv[1]?.endsWith(".ts") });
  const server = app.listen(config.port, config.host, () => {
    const displayHost = config.lanPassword
      ? lanAddress() || (config.host === "0.0.0.0" ? "127.0.0.1" : config.host)
      : config.host;
    const address = `http://${displayHost === "::1" ? "[::1]" : displayHost}:${config.port}`;
    const lines = [
      "",
      "Filemager",
      `  ${config.lanPassword ? "LAN" : "Local"}: ${address}`,
      `  Access: ${config.allVolumes ? "All accessible volumes" : "Configured volumes"} · OS permissions apply`,
      config.lanPassword ? "  LAN access: enabled · PIN required" : "  Local access: this device only",
    ];
    if (config.lanPassword)
      lines.push(`  PIN: ${config.lanPassword}`, "  (new each run — stops working when this server stops)");
    console.log(lines.join("\n") + "\n");
    console.log("  Scan this QR code to open Filemager:");
    qrcode.generate(address, { small: true });
    console.log("");
  });
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 15000;
  server.on("error", (e) => {
    console.error(`Server could not start: ${e.message}`);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      server.close();
      setTimeout(() => process.exit(0), 3000).unref();
    });
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
