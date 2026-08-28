import { config } from "./config.ts";
import * as store from "./services/store.ts";
import * as webhooks from "./services/webhooks.ts";
import * as simulator from "./services/simulator.ts";
import { buildApp } from "./app.ts";
import { describeRateLimit } from "./services/rate-limit.ts";
import { AUTH_DISABLED, CLIENT_ID, CLIENT_SECRET, USERNAME, PASSWORD } from "./auth.ts";

const { host: HOST, port: PORT, apiPrefix: API_PREFIX } = config.server;
const SEED_COUNT = config.simulator.seedCount;

async function start(): Promise<void> {
  const app = await buildApp();
  webhooks.start();
  await simulator.seed(SEED_COUNT);
  simulator.startPeriodicGeneration();
  await app.listen({ port: PORT, host: HOST });
  console.log(
    `\n=== Réformock — Mock PDP Flow Service (AFNOR Flow Service 1.3.0 / XP Z12-013) ===`,
  );
  console.log(`API           : http://localhost:${PORT}${API_PREFIX}`);
  console.log(`Healthcheck   : GET ${API_PREFIX}/healthcheck`);
  console.log(`OIDC discovery: GET /.well-known/openid-configuration`);
  if (AUTH_DISABLED) {
    console.log(`Auth OAuth2   : DÉSACTIVÉE (AUTH_DISABLED=true)`);
  } else {
    console.log(`Auth OAuth2   : POST /oauth/token — grants: client_credentials, password`);
    console.log(`  client_credentials : client_id=${CLIENT_ID}, client_secret=${CLIENT_SECRET}`);
    console.log(`  password           : + username=${USERNAME}, password=${PASSWORD}`);
  }
  console.log(`Rate limit    : ${describeRateLimit()}`);
  console.log(`Flux initiaux : ${store.count()}\n`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      app.close().then(
        () => process.exit(0),
        (err: unknown) => {
          console.error(err);
          process.exit(1);
        },
      );
    });
  }
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
