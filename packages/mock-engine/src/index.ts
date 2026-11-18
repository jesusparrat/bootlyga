import { createMock } from "./server.ts";

const port = Number(process.env.PORT ?? 6878);
const host = process.env.HOST ?? "0.0.0.0";
const mock = createMock();
mock.server.listen(port, host, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "mock engine", host, port }));
});
