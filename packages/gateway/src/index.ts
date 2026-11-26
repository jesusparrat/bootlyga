import { loadConfig } from "./config.ts";
import { log } from "./log.ts";
import { createApp } from "./server.ts";

const config = loadConfig(process.env);
const server = createApp(config);
server.listen(config.port, config.host, () => {
  log("info", "gateway escuchando", {
    host: config.host,
    port: config.port,
    ace: new URL(config.aceBase).host,
  });
});

let closing = false;
function stop(signal: NodeJS.Signals) {
  if (closing) return;
  closing = true;
  log("info", "cerrando gateway", { signal });
  void server.shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      log("error", "error al cerrar gateway", {
        message: error instanceof Error ? error.message : "error",
      });
      process.exit(1);
    },
  );
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
