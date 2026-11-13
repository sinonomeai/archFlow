import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * 环境变量是进程启动的第一道外部输入，用 Zod 统一校验。
 * 默认值只服务于本地开发；生产必须显式提供 DATABASE_URL / REDIS_URL / MinIO 凭证。
 */
const BooleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:3000"),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://archflow:archflow@localhost:5432/archflow"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  MINIO_ENDPOINT: z.string().min(1).default("localhost"),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_USE_SSL: BooleanString,
  MINIO_ACCESS_KEY: z.string().min(1).default("minioadmin"),
  MINIO_SECRET_KEY: z.string().min(1).default("minioadmin"),
  MINIO_BUCKET: z.string().min(1).default("archflow"),

  /** 认证：生产必须覆盖默认值；access 15 分钟、refresh 30 天。 */
  JWT_SECRET: z.string().min(16).default("archflow-dev-secret-change-me"),
  JWT_ACCESS_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 60 * 60),

  /** Chat：兼容 OpenAI 协议；本地默认 deepseek-flash。 */
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.deepseek.com/v1"),
  OPENAI_MODEL: z.string().default("deepseek-flash"),
  /** 单次请求输出上限；deepseek-flash 的 reasoning 也占用该预算。 */
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(16384),

  /** Embedding：千问兼容 OpenAI 协议；未配置时 RAG 降级为关键词检索。 */
  EMBEDDING_API_KEY: z.string().default(""),
  EMBEDDING_BASE_URL: z
    .string()
    .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  EMBEDDING_MODEL: z.string().default("text-embedding-v4"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1536),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

const configDir = dirname(fileURLToPath(import.meta.url));

/**
 * 本地开发优先读 apps/api/.env，其次读仓库根 .env；
 * 生产环境由容器注入，文件不存在时跳过。
 * 要求 Node >= 20.12（process.loadEnvFile）。
 */
const ENV_FILES = [
  resolve(configDir, "../../.env"),
  resolve(configDir, "../../../../.env"),
];

const loadDotEnv = (): void => {
  const envFile = ENV_FILES.find((path) => existsSync(path));

  if (envFile) {
    loadEnvFile(envFile);
  }
};

/** 进程内只解析一次；测试需要切换 env 时调用 resetEnvCache。 */
export const loadEnv = (): Env => {
  if (!cachedEnv) {
    loadDotEnv();
    cachedEnv = EnvSchema.parse(process.env);
  }

  return cachedEnv;
};

export const resetEnvCache = (): void => {
  cachedEnv = null;
};
