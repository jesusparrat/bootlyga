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
