import type { AccessTokenResult, AuthResult, FieldError, LoginInput, RegisterInput, User } from "@arch-flow/shared";
import { ERROR_CODES } from "@arch-flow/shared/constants/error-codes";

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

/**
 * 只校验统一响应外壳（API 文档 §1.3）。
 *
 * 实体字段的 Zod 校验由服务端在返回前完成（mock 路由的 mockOk、真实 API 的
 * ZodValidationPipe），客户端不再重复 parse 一遍：
 * 这份重复校验会把整个 zod 及全部 locale 打进首屏 JS（dev 下约 1.5MB）。
 * 返回类型仍由 @arch-flow/shared 的 schema 推导，调用方用泛型声明期望数据。
 */
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
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error(`服务端返回了非法 JSON（HTTP ${response.status}）`);
  }

  return parseEnvelope(payload);
};

const MOCK_ROOT = "/api/mock/";
const AUTH_ROOT = `${MOCK_ROOT}auth/`;
const AUTH_LOCK = "archflow-mock-auth";
const AUTH_TIMEOUT_MS = 12_000;

type AuthState =
  | { status: "checking" | "anonymous"; user: null }
  | { status: "unavailable"; user: null; message: string }
  | { status: "authenticated"; user: User };

const INITIAL_AUTH_STATE: AuthState = { status: "checking", user: null };
const authListeners = new Set<() => void>();
let authState: AuthState = INITIAL_AUTH_STATE;
let accessToken: string | null = null;
let authEpoch = 0;
let authTail: Promise<void> = Promise.resolve();
let refreshFlight: { epoch: number; promise: Promise<void> } | null = null;
let authChannel: BroadcastChannel | null = null;

export const getAuthState = (): AuthState => authState;
export const getInitialAuthState = (): AuthState => INITIAL_AUTH_STATE;

export const subscribeToAuthState = (listener: () => void) => {
  authListeners.add(listener);
  return () => { authListeners.delete(listener); };
};

const setAuthState = (state: AuthState, token: string | null = null) => {
  if (state.user?.id !== authState.user?.id) authEpoch += 1;
  accessToken = token;
  authState = state;
  for (const listener of authListeners) listener();
};

const endSession = () => {
  authEpoch += 1;
  setAuthState({ status: "anonymous", user: null });
};

const runAuthExclusive = async <T>(work: () => Promise<T>, requireWebLock = false): Promise<T> => {
  const previous = authTail;
  let release = () => {};
  authTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;

  try {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (locks) return await locks.request(AUTH_LOCK, work);
    if (requireWebLock) throw new Error("此浏览器无法安全续期，请使用支持 Web Locks 的浏览器并通过 localhost 或 HTTPS 访问");
    return await work();
  } finally {
    release();
  }
};

const readApiData = async <T>(response: Response): Promise<T> => {
  const envelope = await readEnvelope(response);
  if (!response.ok || envelope.code !== ERROR_CODES.OK || envelope.data === null) {
    throw new ApiError(envelope.code, envelope.message, envelope.errors);
  }
  return envelope.data as T;
};

const getErrorCode = async (response: Response) => {
  try {
    return (await readEnvelope(response.clone())).code;
  } catch {
    return null;
  }
};

const getBrowserOrigin = () => {
  const origin = globalThis.location?.origin;
  if (!origin) throw new Error("认证请求仅可在浏览器中发起");
  return origin;
};

const fetchAuth = (action: string, init?: RequestInit) =>
  fetch(new URL(`${AUTH_ROOT}${action}`, getBrowserOrigin()).href, {
    ...init,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });

const refreshInsideLock = async (epoch: number, expiredToken?: string) => {
  if (epoch !== authEpoch || (expiredToken && accessToken && expiredToken !== accessToken)) return;

  const response = await fetchAuth("refresh", { method: "POST" });
  if (epoch !== authEpoch) return;
  if (response.status === 401 && await getErrorCode(response) === ERROR_CODES.REFRESH_INVALID) {
    endSession();
    return;
  }

  const result = await readApiData<AccessTokenResult>(response);
  const current = await fetchAuth("me", { headers: { Authorization: `Bearer ${result.accessToken}` } });
  if (epoch !== authEpoch) return;
  if (current.status === 401 && await getErrorCode(current) === ERROR_CODES.TOKEN_INVALID) {
    endSession();
    return;
  }
  const user = await readApiData<User>(current);
  if (epoch === authEpoch) setAuthState({ status: "authenticated", user }, result.accessToken);
};

const refreshSession = async (expiredToken?: string) => {
  const epoch = authEpoch;
  if (refreshFlight?.epoch === epoch) return refreshFlight.promise;

  const flight = {
    epoch,
    promise: runAuthExclusive(() => refreshInsideLock(epoch, expiredToken), true),
  };
  refreshFlight = flight;
  try {
    await flight.promise;
  } finally {
    if (refreshFlight === flight) refreshFlight = null;
  }
};

export const restoreSession = async () => {
  if (authState.status !== "checking") setAuthState(INITIAL_AUTH_STATE);
  const epoch = authEpoch;
  try {
    await refreshSession();
  } catch (error) {
    if (epoch === authEpoch && authState.status === "checking") {
      const message = error instanceof Error ? error.message : "会话恢复失败，请重试";
      setAuthState({ status: "unavailable", user: null, message });
    }
  }
};

export const connectAuthTabs = () => {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(AUTH_LOCK);
  authChannel = channel;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data === "signed-out") endSession();
    if (event.data === "signed-in") {
      endSession();
      void restoreSession();
    }
  };
  return () => {
    channel.close();
    if (authChannel === channel) authChannel = null;
  };
};

const submitCredentials = (action: "register" | "login", input: RegisterInput | LoginInput, key?: string) =>
  runAuthExclusive(async () => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (key) headers.set("Idempotency-Key", key);
    const response = await fetchAuth(action, { method: "POST", headers, body: JSON.stringify(input) });
    const result = await readApiData<AuthResult>(response);
    authEpoch += 1;
    setAuthState({ status: "authenticated", user: result.user }, result.accessToken);
    authChannel?.postMessage("signed-in");
  });

export const signIn = (input: LoginInput) => submitCredentials("login", input);
export const signUp = (input: RegisterInput, key: string) => submitCredentials("register", input, key);

export const signOut = () => runAuthExclusive(async () => {
  const current = accessToken;
  if (!current) return;

  const epoch = authEpoch;
  const send = (token: string) => fetchAuth("logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  let response = await send(current);
  if (response.status === 401 && await getErrorCode(response) === ERROR_CODES.TOKEN_EXPIRED) {
    if (typeof navigator === "undefined" || !navigator.locks) {
      throw new Error("此浏览器无法安全续期，请使用支持 Web Locks 的浏览器退出登录");
    }
    await refreshInsideLock(epoch, current);
    if (epoch !== authEpoch || !accessToken) return;
    response = await send(accessToken);
  }
  if (epoch !== authEpoch) return;
  if (!response.ok) {
    const error = await readEnvelope(response);
    if (error.code === ERROR_CODES.TOKEN_INVALID) {
      endSession();
      return;
    }
    throw new ApiError(error.code, error.message, error.errors);
  }
  endSession();
  authChannel?.postMessage("signed-out");
});

export const authenticatedFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  const origin = getBrowserOrigin();
  const target = new URL(input, origin);
  if (target.origin !== origin || !target.pathname.startsWith(MOCK_ROOT) || target.pathname.startsWith(AUTH_ROOT)) {
    throw new Error("请求目标不属于受信任的本地 API");
  }

  const epoch = authEpoch;
  const requestedToken = accessToken;
  const send = (token: string | null) => {
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    else headers.delete("Authorization");
    return fetch(target.href, { ...init, headers, credentials: "same-origin", redirect: "error", cache: "no-store" });
  };
  const ensureCurrent = () => {
    if (epoch !== authEpoch) throw new DOMException("登录会话已切换", "AbortError");
    init?.signal?.throwIfAborted();
  };

  let response = await send(requestedToken);
  ensureCurrent();
  if (response.status === 401) {
    const code = await getErrorCode(response);
    ensureCurrent();
    if (code === ERROR_CODES.TOKEN_EXPIRED && requestedToken && !(init?.body instanceof ReadableStream)) {
      await refreshSession(requestedToken);
      ensureCurrent();
      if (accessToken) {
        response = await send(accessToken);
        ensureCurrent();
      }
    } else if (code === ERROR_CODES.TOKEN_INVALID || code === ERROR_CODES.TOKEN_MISSING) {
      endSession();
    }
  }
  return response;
};

/**
 * 无响应体的请求入口：用于 DELETE 等契约规定 `204 No Content` 的接口。
 * 失败时仍按统一外壳解析错误信息。
 */
export const requestApiVoid = async (
  path: string,
  init?: RequestInit,
): Promise<void> => {
  const response = await authenticatedFetch(path, init);

  if (response.ok) {
    return;
  }

  const envelope = await readEnvelope(response);

  throw new ApiError(envelope.code, envelope.message, envelope.errors);
};

/**
 * 统一请求入口：校验 ApiResponse 外壳并返回 data。
 * 失败（code !== OK 或 data === null）抛 ApiError。
 */
export const requestApi = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return readApiData<T>(await authenticatedFetch(path, { ...init, headers }));
};
