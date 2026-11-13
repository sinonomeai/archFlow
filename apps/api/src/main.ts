import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./config/env.js";
import { traceIdMiddleware } from "./common/trace-id.middleware.js";
import type { RequestWithContext } from "./common/request-context.js";

const logger = new Logger("Bootstrap");

const bootstrap = async (): Promise<void> => {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const log = pino({
    level: env.NODE_ENV === "production" ? "info" : "debug",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
      ],
      censor: "[REDACTED]",
    },
  });

  app.use(traceIdMiddleware);
  app.use(
    pinoHttp({
      logger: log,
      genReqId: (request) =>
        (request as RequestWithContext).traceId ?? "unknown",
      customProps: (request) => ({
        traceId: (request as RequestWithContext).traceId,
      }),
    }),
  );
  app.use(cookieParser());
  app.use(json({ limit: "2mb" }));
  app.use(urlencoded({ extended: true, limit: "2mb" }));

  app.setGlobalPrefix("api/v1");
  app.enableCors({
    /** 允许逗号分隔的多个本地 origin（localhost / 127.0.0.2）。 */
    origin: env.WEB_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
    exposedHeaders: ["X-Trace-Id"],
  });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
};

void bootstrap().catch((error: unknown) => {
  logger.error(
    "API 启动失败",
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
