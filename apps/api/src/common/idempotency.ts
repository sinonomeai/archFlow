import {
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Response } from "express";
import { from, of, switchMap, tap, type Observable } from "rxjs";
import { ERROR_CODES } from "@arch-flow/shared";
import { apiError } from "./api-error.js";
import { getRequest } from "./request-context.js";
import { RedisService } from "../infra/redis.service.js";

type StoredResponse = {
  status: number;
  body: unknown;
  requestHash: string;
};

const TTL_SECONDS = 24 * 60 * 60;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);

const hashBody = (body: unknown): string =>
  createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");

@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: RedisService) {}

  get = async (key: string): Promise<StoredResponse | null> => {
    const raw = await this.redis.client.get(key);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as StoredResponse;
    } catch {
      return null;
    }
  };

  set = async (key: string, value: StoredResponse): Promise<void> => {
    await this.redis.client.set(
      key,
      JSON.stringify(value),
      "EX",
      TTL_SECONDS,
    );
  };
}

/**
 * Idempotency-Key 去重：同一用户 + 同一路径 + 同一 key 在 24h 内复用首次响应。
 * 同 key 不同请求体按契约返回 409 IDEMPOTENCY_KEY_REUSED。
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept = (
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> => {
    const request = getRequest(context);
    const response = context.switchToHttp().getResponse<Response>();
    const header = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(header) ? header[0] : header;

    if (
      !idempotencyKey ||
      !MUTATING_METHODS.has(request.method) ||
      !request.user
    ) {
      return next.handle();
    }

    const cacheKey = `idem:${request.user.uuid}:${request.method}:${request.originalUrl}:${idempotencyKey}`;
    const requestHash = hashBody(request.body);

    return from(this.idempotency.get(cacheKey)).pipe(
      switchMap((cached) => {
        if (cached) {
          if (cached.requestHash !== requestHash) {
            throw apiError(
              HttpStatus.CONFLICT,
              ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
              "Idempotency-Key 已用于不同请求",
            );
          }

          response.status(cached.status);
          return of(cached.body);
        }

        return next.handle().pipe(
          tap((body) => {
            if (response.statusCode >= 200 && response.statusCode < 300) {
              void this.idempotency.set(cacheKey, {
                status: response.statusCode,
                body,
                requestHash,
              });
            }
          }),
        );
      }),
    );
  };
}
