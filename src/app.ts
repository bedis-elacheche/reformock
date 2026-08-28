import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyHelmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import fastifyFormbody from "@fastify/formbody";
import fastifyRateLimit from "@fastify/rate-limit";

import { config } from "./config.ts";
import { connectRateLimitRedis, closeRateLimitRedis } from "./services/rate-limit.ts";
import { sendError } from "./utils/http.ts";
import { tokenEndpoint, bearerMiddleware, AUTH_DISABLED } from "./auth.ts";

import { getHealthcheck } from "./routes/healthcheck.ts";
import { getOidcDiscovery } from "./routes/well-known.ts";
import { registerFlowRoutes } from "./routes/flows/index.ts";
import { registerWebhookRoutes } from "./routes/webhooks/index.ts";
import { registerAdminRoutes } from "./routes/admin/index.ts";

import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { Res } from "./utils/http.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { apiPrefix: API_PREFIX } = config.server;
const MAX_FILE_BYTES = config.server.maxFileBytes;
const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  if (config.rateLimit.enabled) {
    const redis = await connectRateLimitRedis();
    if (redis) {
      app.addHook("onClose", () => closeRateLimitRedis(redis));
    }
    await app.register(fastifyRateLimit, {
      global: true,
      max: config.rateLimit.max,
      timeWindow: config.rateLimit.windowMs,
      ...(redis ? { redis, nameSpace: config.rateLimit.redisNamespace } : {}),
      allowList: (req) => req.url.split("?")[0].endsWith("/healthcheck"),
      errorResponseBuilder: (_req, context) => {
        const err = new Error(
          `Trop de requêtes : limite de ${context.max} requêtes par ${Math.round(config.rateLimit.windowMs / 1000)}s atteinte. Réessayez dans ${context.after}.`,
        ) as FastifyError & { errorCode: string };
        err.statusCode = context.statusCode;
        err.errorCode = "RATE_LIMIT_EXCEEDED";
        return err;
      },
    });
  }
  await app.register(fastifyFormbody);
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: config.server.maxUploadFiles },
  });
  await app.register(fastifyStatic, { root: path.join(__dirname, "..", "public") });

  app.post("/oauth/token", tokenEndpoint);
  app.get("/.well-known/openid-configuration", getOidcDiscovery);

  const uiConfig = { apiPrefix: API_PREFIX, authDisabled: AUTH_DISABLED };
  const configJs = `window.__REFORMOCK_CONFIG__ = ${JSON.stringify(uiConfig)};\n`;

  app.get("/config.js", (_req: FastifyRequest, res: FastifyReply) => {
    res.type("application/javascript").send(configJs);
  });

  app.register(
    async (api) => {
      api.get("/healthcheck", getHealthcheck);

      api.register(async (secure) => {
        secure.addHook("preHandler", bearerMiddleware);

        registerFlowRoutes(secure);
        registerWebhookRoutes(secure);
        registerAdminRoutes(secure);
      });
    },
    { prefix: API_PREFIX },
  );

  app.setNotFoundHandler((req: FastifyRequest, res: FastifyReply) => {
    const reqPath = req.url.split("?")[0];
    return sendError(
      res as Res,
      404,
      "MISSING_RESOURCE",
      `Route inconnue : ${req.method} ${reqPath} (préfixe API : ${API_PREFIX})`,
    );
  });

  app.setErrorHandler((err: FastifyError, req: FastifyRequest, res: FastifyReply) => {
    const code = err.code;
    const status = err.statusCode || 500;
    if (status === 413 || code === "FST_REQ_FILE_TOO_LARGE" || code === "LIMIT_FILE_SIZE") {
      return sendError(
        res as Res,
        413,
        "FILE_SIZE_EXCEEDED",
        `Provided file is too big (max ${MAX_FILE_MB} MB).`,
      );
    }
    if (
      err instanceof SyntaxError ||
      code === "FST_ERR_CTP_INVALID_JSON" ||
      (status === 400 && typeof code === "string" && code.startsWith("FST_ERR_CTP"))
    ) {
      return sendError(res as Res, 400, "MALFORMED_JSON", "Corps JSON invalide.");
    }
    if (status === 429 || (err as { errorCode?: string }).errorCode === "RATE_LIMIT_EXCEEDED") {
      return sendError(
        res as Res,
        status,
        (err as { errorCode?: string }).errorCode ?? "RATE_LIMIT_EXCEEDED",
        err.message,
      );
    }
    console.error(err);
    return sendError(res as Res, 500, "INTERNAL_ERROR", "Erreur interne du serveur.");
  });

  return app;
}
