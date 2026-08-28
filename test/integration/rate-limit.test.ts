import assert from "node:assert/strict";
import process from "node:process";
import crypto from "node:crypto";
import test from "node:test";

import type { FastifyInstance } from "fastify";

const REDIS_URL = process.env.TEST_REDIS_URL;
const MAX = 5;

// Ces tests exigent un Redis joignable ; sans TEST_REDIS_URL, ils sont ignorés.
// La configuration est lue à l'import de `src/config.ts` : elle est donc posée
// ici, avant l'import dynamique de `buildApp`.
if (REDIS_URL) {
  process.env.REDIS_URL = REDIS_URL;
  process.env.RATE_LIMIT_ENABLED = "true";
  process.env.RATE_LIMIT_MAX = String(MAX);
  process.env.RATE_LIMIT_WINDOW_SECONDS = "60";
  process.env.RATE_LIMIT_REDIS_REQUIRED = "true";
  process.env.RATE_LIMIT_REDIS_NAMESPACE = `reformock-test:${crypto.randomUUID()}:`;
}

async function newRateLimitedApp(): Promise<FastifyInstance> {
  const { buildApp } = await import("../../src/app.ts");
  return buildApp();
}

function hit(app: FastifyInstance): Promise<{ statusCode: number; payload: string }> {
  return app.inject({ method: "GET", url: "/config.js" });
}

test(
  "le compteur de débit vit dans Redis et est partagé entre instances",
  { skip: REDIS_URL ? false : "TEST_REDIS_URL non défini" },
  async (t) => {
    const app1 = await newRateLimitedApp();
    const app2 = await newRateLimitedApp();
    t.after(() => Promise.all([app1.close(), app2.close()]));

    for (let i = 0; i < MAX; i++) {
      assert.equal((await hit(app1)).statusCode, 200, `requête ${i + 1} dans la fenêtre`);
    }

    const blocked = await hit(app1);
    assert.equal(blocked.statusCode, 429);
    assert.equal(JSON.parse(blocked.payload).errorCode, "RATE_LIMIT_EXCEEDED");

    // La seconde instance ne partage aucune mémoire : seul Redis peut la bloquer.
    const shared = await hit(app2);
    assert.equal(shared.statusCode, 429);
    assert.equal(JSON.parse(shared.payload).errorCode, "RATE_LIMIT_EXCEEDED");
  },
);
