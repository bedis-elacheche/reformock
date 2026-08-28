import { Redis } from "ioredis";

import { config } from "../config.ts";

const CONNECT_TIMEOUT_MS = 5_000;
const ERROR_LOG_INTERVAL_MS = 30_000;

let backend: "redis" | "memory" = "memory";

let memoryFallbackLogged = false;

function warnMemoryFallback(reason: string): void {
  if (memoryFallbackLogged) {
    return;
  }
  memoryFallbackLogged = true;
  console.warn(`[rate-limit] ${reason} : compteur en mémoire (non partagé entre instances).`);
}

/** Masque le mot de passe éventuellement présent dans l'URL avant journalisation. */
export function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export interface RateLimitRedisOptions {
  url?: string;
  required?: boolean;
}

/**
 * Crée un client Redis dédié à la limitation de débit. Le client échoue vite
 * (pas de file d'attente hors-ligne) : `@fastify/rate-limit` laisse alors passer
 * la requête plutôt que de renvoyer une erreur au client (`skipOnError`).
 */
export function createRateLimitRedis(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  let lastLoggedAt = 0;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) {
      return;
    }
    lastLoggedAt = now;
    console.error(`[rate-limit] Redis indisponible : ${err.message}`);
  });

  return client;
}

/**
 * Ouvre la connexion Redis utilisée par la limitation de débit.
 *
 * - sans `REDIS_URL` : renvoie `null`, le plugin retombe sur son compteur
 *   en mémoire (une instance = un compteur) ;
 * - avec `REDIS_URL` injoignable : renvoie `null` après un avertissement, sauf
 *   si `RATE_LIMIT_REDIS_REQUIRED=true` — le démarrage échoue alors.
 */
export async function connectRateLimitRedis(
  options: RateLimitRedisOptions = {},
): Promise<Redis | null> {
  const url = options.url ?? config.rateLimit.redisUrl;
  const required = options.required ?? config.rateLimit.redisRequired;

  if (!url) {
    if (required) {
      throw new Error("RATE_LIMIT_REDIS_REQUIRED=true mais REDIS_URL n'est pas défini.");
    }
    warnMemoryFallback("REDIS_URL non défini");
    return null;
  }

  const client = createRateLimitRedis(url);
  try {
    await client.connect();
    await client.ping();
    backend = "redis";
    return client;
  } catch (err) {
    client.disconnect();
    const message = err instanceof Error ? err.message : String(err);
    if (required) {
      throw new Error(`Connexion Redis impossible (${redactRedisUrl(url)}) : ${message}`);
    }
    warnMemoryFallback(`connexion Redis impossible (${message})`);
    return null;
  }
}

/** Résumé lisible de la configuration de limitation de débit, pour les logs de démarrage. */
export function describeRateLimit(): string {
  const { enabled, max, windowMs, redisUrl } = config.rateLimit;
  if (!enabled) {
    return "DÉSACTIVÉE (RATE_LIMIT_ENABLED=false)";
  }
  const window = `${max} req / ${Math.round(windowMs / 1000)}s par IP`;
  return backend === "redis" && redisUrl
    ? `${window} — Redis ${redactRedisUrl(redisUrl)}`
    : `${window} — mémoire (instance locale)`;
}

export async function closeRateLimitRedis(client: Redis): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
