import process from "node:process";
import { z } from "zod";

function loadDotEnv(): void {
  const file = process.env.ENV_FILE || ".env";
  try {
    process.loadEnvFile(file);
  } catch {}
}

loadDotEnv();

const ConfigSchema = z
  .object({
    NODE_ENV: z.string().trim().default("development"),
    HOST: z.string().trim().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_PREFIX: z.string().trim().default("/v1"),
    MAX_FILE_MB: z.coerce.number().int().min(1).default(10),
    MAX_UPLOAD_FILES: z.coerce.number().int().min(1).default(10),
    AUTH_DISABLED: z.stringbool().default(false),
    OAUTH_CLIENT_ID: z.string().trim().default("test-client"),
    OAUTH_CLIENT_SECRET: z.string().trim().optional(),
    OAUTH_USERNAME: z.string().trim().default("test-user"),
    OAUTH_PASSWORD: z.string().trim().default("test-password"),
    TOKEN_TTL_SECONDS: z.coerce.number().int().min(1).default(3600),
    SEED_COUNT: z.coerce.number().int().min(0).default(20),
    GENERATION_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),
    LIFECYCLE_DELAY_SECONDS: z.coerce.number().int().min(0).default(15),
    MAX_FLOWS: z.coerce.number().int().min(0).default(1000),
    MAX_STORE_MB: z.coerce.number().int().min(0).default(384),
    MAX_WEBHOOKS: z.coerce.number().int().min(0).default(50),
    WEBHOOK_ALLOW_PRIVATE: z.stringbool().default(false),
    RATE_LIMIT_ENABLED: z.stringbool().default(true),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
    // Une valeur vide (`REDIS_URL=` dans .env) équivaut à « non défini ».
    REDIS_URL: z.union([z.literal(""), z.url({ protocol: /^rediss?$/ })]).optional(),
    RATE_LIMIT_REDIS_NAMESPACE: z.string().trim().default("reformock:rate-limit:"),
    RATE_LIMIT_REDIS_REQUIRED: z.stringbool().default(false),
  })
  .transform((env) => ({
    nodeEnv: env.NODE_ENV,
    server: {
      host: env.HOST,
      port: env.PORT,
      apiPrefix: env.API_PREFIX,
      maxFileBytes: env.MAX_FILE_MB * 1024 * 1024,
      maxUploadFiles: env.MAX_UPLOAD_FILES,
    },
    auth: {
      disabled: env.AUTH_DISABLED,
      clientId: env.OAUTH_CLIENT_ID,
      clientSecret: env.OAUTH_CLIENT_SECRET,
      username: env.OAUTH_USERNAME,
      password: env.OAUTH_PASSWORD,
      tokenTtlSeconds: env.TOKEN_TTL_SECONDS,
    },
    simulator: {
      seedCount: env.SEED_COUNT,
      generationIntervalSeconds: env.GENERATION_INTERVAL_SECONDS,
      lifecycleDelaySeconds: env.LIFECYCLE_DELAY_SECONDS,
    },
    store: {
      maxFlows: env.MAX_FLOWS,
      maxStoreBytes: env.MAX_STORE_MB * 1024 * 1024,
    },
    webhooks: {
      max: env.MAX_WEBHOOKS,
      allowPrivate: env.WEBHOOK_ALLOW_PRIVATE,
    },
    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED,
      max: env.RATE_LIMIT_MAX,
      windowMs: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
      redisUrl: env.REDIS_URL || undefined,
      redisNamespace: env.RATE_LIMIT_REDIS_NAMESPACE,
      redisRequired: env.RATE_LIMIT_REDIS_REQUIRED,
    },
  }));

export const config = ConfigSchema.parse(process.env);
