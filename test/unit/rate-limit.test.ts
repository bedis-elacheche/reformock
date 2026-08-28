import assert from "node:assert/strict";
import test from "node:test";

import {
  closeRateLimitRedis,
  connectRateLimitRedis,
  createRateLimitRedis,
  describeRateLimit,
  redactRedisUrl,
} from "../../src/services/rate-limit.ts";

// Port fermé : sert de cible injoignable pour les cas de repli.
const UNREACHABLE_URL = "redis://127.0.0.1:6390";

test("redactRedisUrl masque le mot de passe", () => {
  assert.equal(
    redactRedisUrl("redis://user:s3cr3t@cache.example.com:6379/0"),
    "redis://user:***@cache.example.com:6379/0",
  );
  assert.equal(redactRedisUrl("redis://cache.example.com:6379"), "redis://cache.example.com:6379");
  assert.equal(redactRedisUrl("pas-une-url"), "pas-une-url");
});

test("sans REDIS_URL, repli sur le compteur en mémoire", async () => {
  assert.equal(await connectRateLimitRedis({ url: undefined, required: false }), null);
});

test("sans REDIS_URL et REDIS requis, le démarrage échoue", async () => {
  await assert.rejects(
    () => connectRateLimitRedis({ url: undefined, required: true }),
    /REDIS_URL/,
  );
});

test("Redis injoignable : repli en mémoire par défaut", async () => {
  assert.equal(await connectRateLimitRedis({ url: UNREACHABLE_URL, required: false }), null);
});

test("Redis injoignable et requis : le démarrage échoue", async () => {
  await assert.rejects(
    () => connectRateLimitRedis({ url: UNREACHABLE_URL, required: true }),
    /Connexion Redis impossible/,
  );
});

test("le client n'attend pas la reconnexion pour échouer", async () => {
  const client = createRateLimitRedis(UNREACHABLE_URL);
  await assert.rejects(() => client.ping());
  await closeRateLimitRedis(client);
});

test("describeRateLimit décrit le compteur utilisé", () => {
  // Les tests tournent sans REDIS_URL : compteur en mémoire.
  assert.match(describeRateLimit(), /mémoire/);
});
