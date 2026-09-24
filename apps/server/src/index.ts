import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
try {
  const config = await loadConfig();
  const { app } = await createApp(config, { dev: process.argv[1]?.endsWith(".ts") });
  const server = app.listen(config.port, config.host, () => {
    const address = `http://${config.host === "::1" ? "[::1]" : config.host}:${config.port}`;
    const lines = [
      "",
      "Studio Files",
      `  ${config.lanPassword ? "Network" : "Local"}: ${address}`,
      `  Access: ${config.allVolumes ? "All accessible volumes" : "Configured volumes"} · OS permissions apply`,
      config.lanPassword
        ? "  Network access: enabled · PIN required"
        : "  Network access: disabled in no-login mode",
    ];
    if (config.lanPassword)
      lines.push(`  PIN: ${config.lanPassword}`, "  (new each run — stops working when this server stops)");
    console.log(lines.join("\n") + "\n");
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
