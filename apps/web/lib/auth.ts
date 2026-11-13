"use client";

import type {
  AccessTokenResult,
  AuthResult,
  LoginInput,
  RegisterInput,
  User,
} from "@arch-flow/shared";
import { apiUrl } from "./api-config";
import { useAuthStore } from "./auth-store";
import { clearSessionHint } from "./session";

type Envelope<T> = {
  code: string;
  message: string;
  data: T | null;
};

let refreshPromise: Promise<boolean> | null = null;

const readEnvelope = async <T>(response: Response): Promise<Envelope<T>> => {
  const payload = (await response.json().catch(() => null)) as Envelope<T> | null;

  if (!payload || typeof payload.code !== "string") {
    throw new Error(`服务端返回了非法响应（HTTP ${response.status}）`);
  }

  return payload;
};

const postJson = async <T>(
  path: string,
  body?: unknown,
): Promise<T> => {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const envelope = await readEnvelope<T>(response);

  if (!response.ok || envelope.code !== "OK" || envelope.data === null) {
    throw new Error(envelope.message);
  }

  return envelope.data;
};

export const loginRequest = async (input: LoginInput): Promise<AuthResult> => {
  const result = await postJson<AuthResult>("/auth/login", input);
  useAuthStore.getState().setAuth(result.accessToken, result.user);

  return result;
};

export const registerRequest = async (
  input: RegisterInput,
): Promise<AuthResult> => {
  const result = await postJson<AuthResult>("/auth/register", input);
  useAuthStore.getState().setAuth(result.accessToken, result.user);

  return result;
};

const performRefresh = async (): Promise<boolean> => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const result = await postJson<AccessTokenResult>("/auth/refresh");
        useAuthStore.getState().setAccessToken(result.accessToken);
        return true;
      } catch {
        useAuthStore.getState().clear();
        clearSessionHint();
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
};

/**
 * 并发去重的静默续期；失败时清空登录态。
 * 多标签页共享 refreshToken Cookie，必须用跨标签锁串行刷新，
 * 否则两个标签同时轮转会让其中一个拿到 REFRESH_INVALID。
 */
export const refreshAccessToken = async (): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("archflow:auth-refresh", () =>
      performRefresh(),
    );
  }

  return performRefresh();
};

export const loadCurrentUser = async (): Promise<User | null> => {
  const token = useAuthStore.getState().accessToken;

  if (!token) {
    return null;
  }

  const response = await fetch(apiUrl("/auth/me"), {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  const envelope = await readEnvelope<User>(response);

  if (!response.ok || envelope.code !== "OK" || !envelope.data) {
    return null;
  }

  useAuthStore.getState().setUser(envelope.data);

  return envelope.data;
};

/** 页面刷新后：用 refreshToken Cookie 换 accessToken，再补齐用户信息。 */
export const bootstrapSession = async (): Promise<boolean> => {
  const token = useAuthStore.getState().accessToken;

  if (!token) {
    const refreshed = await refreshAccessToken();

    if (!refreshed) {
      return false;
    }
  }

  const user = await loadCurrentUser();

  return user !== null;
};

export const logoutRequest = async (): Promise<void> => {
  const token = useAuthStore.getState().accessToken;

  try {
    await fetch(apiUrl("/auth/logout"), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ allDevices: false }),
    });
  } finally {
    useAuthStore.getState().clear();
  }
};
