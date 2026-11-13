import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { map, type Observable } from "rxjs";
import { ERROR_CODES, type ApiResponse } from "@arch-flow/shared";
import type { Response } from "express";
import { RAW_RESPONSE_KEY } from "./decorators.js";
import { getRequest } from "./request-context.js";

/**
 * 成功响应统一包装：`{ code: "OK", message, data, traceId }`。
 * 204 / SSE / 健康检查用 @RawResponse() 跳过。
 */
@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept = (
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> => {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isRaw) {
      return next.handle();
    }

    const request = getRequest(context);
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown) => {
        if (data === undefined || response.headersSent) {
          return data;
        }

        const traceId = request.traceId ?? randomUUID();
        response.setHeader("X-Trace-Id", traceId);

        return {
          code: ERROR_CODES.OK,
          message: "success",
          data,
          traceId,
        } satisfies ApiResponse<unknown>;
      }),
    );
  };
}
