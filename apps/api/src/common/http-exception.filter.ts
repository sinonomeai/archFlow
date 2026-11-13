import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import {
  ERROR_CODES,
  FieldError,
  type ApiResponse,
} from "@arch-flow/shared";
import {
  toFieldErrors,
  ZodValidationException,
} from "./zod-validation.pipe.js";

type ErrorBody = {
  code: string;
  message: string;
  errors?: FieldError[];
  data?: unknown;
};

const TRACE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseFieldErrors = (value: unknown): FieldError[] | undefined => {
  const result = z.array(FieldError).safeParse(value);

  return result.success && result.data.length > 0 ? result.data : undefined;
};

const statusCodeToErrorCode = (status: number): string => {
  switch (status) {
    case 400:
      return ERROR_CODES.BAD_REQUEST;
    case 401:
      return ERROR_CODES.TOKEN_INVALID;
    case 413:
      return ERROR_CODES.PAYLOAD_TOO_LARGE;
    case 422:
      return ERROR_CODES.GRAPH_INVALID;
    case 429:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return status >= 500
        ? ERROR_CODES.INTERNAL_ERROR
        : ERROR_CODES.BAD_REQUEST;
  }
};

const resolveTraceId = (request: Request): string => {
  const header = request.headers["x-request-id"];
  const candidate = Array.isArray(header) ? header[0] : header;

  return typeof candidate === "string" && TRACE_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
};

/**
 * 全局异常出口：所有错误都返回 `{ code, message, data: null, errors?, traceId }`。
 *
 * - ZodValidationException：400 / 413 / 422，附字段级 errors；
 * - HttpException：保留模块显式设置的 code，否则按 HTTP 状态兜底；
 * - 其他：500 INTERNAL_ERROR，只记录日志，不把堆栈返回给客户端。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch = (exception: unknown, host: ArgumentsHost): void => {
    const { httpAdapter } = this.httpAdapterHost;
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse();
    const traceId = resolveTraceId(request);
    const { status, body } = this.normalize(exception);

    if (status >= 500) {
      this.logger.error(
        `${status} ${body.code} ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const payload = {
      code: body.code,
      message: body.message,
      data: body.data ?? null,
      ...(body.errors ? { errors: body.errors } : {}),
      traceId,
    } satisfies ApiResponse<unknown>;

    httpAdapter.setHeader(response, "X-Trace-Id", traceId);
    httpAdapter.reply(response, payload, status);
  };

  private readonly normalize = (
    exception: unknown,
  ): { status: number; body: ErrorBody } => {
    if (exception instanceof ZodValidationException) {
      return {
        status: exception.graphError?.httpStatus ?? 400,
        body: {
          code:
            exception.graphError?.errorCode ??
            ERROR_CODES.VALIDATION_FAILED,
          message: exception.message,
          errors: toFieldErrors(exception.issues),
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === "string") {
        return {
          status,
          body: { code: statusCodeToErrorCode(status), message: response },
        };
      }

      if (isRecord(response)) {
        const code =
          typeof response.code === "string"
            ? response.code
            : statusCodeToErrorCode(status);
        const message =
          typeof response.message === "string"
            ? response.message
            : exception.message;

        return {
          status,
          body: {
            code,
            message,
            errors: parseFieldErrors(response.errors),
            ...("data" in response ? { data: response.data } : {}),
          },
        };
      }

      return {
        status,
        body: {
          code: statusCodeToErrorCode(status),
          message: exception.message,
        },
      };
    }

    return {
      status: 500,
      body: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "服务器内部错误",
      },
    };
  };
}
