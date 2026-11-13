import { randomUUID } from "node:crypto";
import type { NextFunction, Response } from "express";
import type { RequestWithContext } from "./request-context.js";

const TRACE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** 每个请求一个 traceId：优先复用上游 X-Request-Id，并回写响应头。 */
export const traceIdMiddleware = (
  request: RequestWithContext,
  response: Response,
  next: NextFunction,
): void => {
  const header = request.headers["x-request-id"];
  const candidate = Array.isArray(header) ? header[0] : header;
  const traceId =
    typeof candidate === "string" && TRACE_ID_PATTERN.test(candidate)
      ? candidate
      : randomUUID();

  request.traceId = traceId;
  response.setHeader("X-Trace-Id", traceId);
  next();
};
