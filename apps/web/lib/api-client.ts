"use client";

import type { FieldError } from "@arch-flow/shared";
import { ERROR_CODES } from "@arch-flow/shared/constants/error-codes";
import { apiUrl } from "./api-config";
import { refreshAccessToken } from "./auth";
import { useAuthStore } from "./auth-store";
import { clearSessionHint } from "./session";

export { apiUrl };

export class ApiError extends Error {
  code: string;
  errors?: FieldError[];

  constructor(code: string, message: string, errors?: FieldError[]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.errors = errors;
  }
}

type ApiEnvelope = {
  code: string;
  message: string;
  data: unknown;
  errors?: FieldError[];
  traceId: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseFieldErrors = (value: unknown): FieldError[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const errors = value.flatMap((item) =>
    isRecord(item) &&
    typeof item.field === "string" &&
    typeof item.code === "string" &&
    typeof item.message === "string"
      ? [{ field: item.field, code: item.code, message: item.message }]
      : [],
  );

  return errors.length > 0 ? errors : undefined;
};

const parseEnvelope = (payload: unknown): ApiEnvelope => {
  if (
    !isRecord(payload) ||
    typeof payload.code !== "string" ||
    typeof payload.message !== "string" ||
    typeof payload.traceId !== "string" ||
    !("data" in payload)
  ) {
    throw new Error("服务端响应不符合 ApiResponse 契约");
  }

  return {
    code: payload.code,
    message: payload.message,
    data: payload.data,
    errors: parseFieldErrors(payload.errors),
    traceId: payload.traceId,
  };
};

const readEnvelope = async (response: Response): Promise<ApiEnvelope> => {
  try {
    return parseEnvelope(await response.json());
  } catch {
    throw new Error(`服务端返回了非法 JSON（HTTP ${response.status}）`);
  }
};

const send = async (
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const headers = new Headers(init?.headers);
  const token = useAuthStore.getState().accessToken;

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // FormData 必须由运行时自动带 boundary，不能手动写成 application/json。
  if (
    init?.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });
};

const clearSessionAndRedirect = (): void => {
  useAuthStore.getState().clear();
  /** 同步清掉路由提示 Cookie，否则 middleware 会把它弹回 /workspace。 */
  clearSessionHint();

  if (
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/login")
  ) {
    window.location.href = "/login";
  }
};

const shouldRefresh = (status: number, code: string): boolean =>
  status === 401 &&
  (code === ERROR_CODES.TOKEN_EXPIRED ||
    code === ERROR_CODES.TOKEN_MISSING ||
    code === ERROR_CODES.TOKEN_INVALID);

const execute = async <T>(
  path: string,
  init: RequestInit | undefined,
  retry: boolean,
  expectData: boolean,
): Promise<T> => {
  const response = await send(path, init);

  if (response.status === 204) {
    return undefined as T;
  }

  const envelope = await readEnvelope(response);

  if (shouldRefresh(response.status, envelope.code) && retry) {
    const refreshed = await refreshAccessToken();

    if (refreshed) {
      return execute<T>(path, init, false, expectData);
    }

    clearSessionAndRedirect();
  }

  if (envelope.code === ERROR_CODES.REFRESH_INVALID) {
    clearSessionAndRedirect();
  }

  if (
    !response.ok ||
    envelope.code !== ERROR_CODES.OK ||
    (expectData && envelope.data === null)
  ) {
    throw new ApiError(envelope.code, envelope.message, envelope.errors);
  }

  return envelope.data as T;
};

/** 统一请求入口：自动带 token、401 静默刷新并重放一次。 */
export const requestApi = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => execute<T>(path, init, true, true);

/** 无响应体入口：DELETE 等 204 接口。 */
export const requestApiVoid = async (
  path: string,
  init?: RequestInit,
): Promise<void> => execute<void>(path, init, true, false);
