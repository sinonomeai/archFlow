import type { NextResponse } from "next/server";
import {
  AccessTokenResult,
  AuthResult,
  ERROR_CODES,
  IdempotencyKey,
  LoginInput,
  LogoutInput,
  RegisterInput,
  User,
} from "@arch-flow/shared";
import {
  MOCK_AUTH_PATH,
  MOCK_REFRESH_COOKIE,
  MOCK_REFRESH_SECONDS,
  getMockRefreshCookie,
  hasMockAuthOrigin,
  loginMockUser,
  logoutMockSession,
  mockAuthUnavailable,
  refreshMockSession,
  registerMockUser,
  requireMockUser,
} from "@/lib/mock-auth";
import { MOCK_ENABLED, mockDisabled, mockError, mockNoContent, mockOk, toFieldErrors } from "@/lib/mock-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ action: string }> };

const setRefreshCookie = (response: NextResponse, value: string) => {
  response.cookies.set(MOCK_REFRESH_COOKIE, value, {
    path: MOCK_AUTH_PATH,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: value ? MOCK_REFRESH_SECONDS : 0,
  });
  return response;
};

const readJson = async (request: Request, emptyBody: unknown = null): Promise<unknown> => {
  try {
    const body = await request.text();
    return body.trim() ? JSON.parse(body) : emptyBody;
  } catch {
    return null;
  }
};

export const GET = async (request: Request, context: RouteContext) => {
  const { action } = await context.params;
  if (action !== "me") return mockError(404, ERROR_CODES.BAD_REQUEST, "接口不存在");

  const user = await requireMockUser(request);
  return user instanceof Response ? user : mockOk(User, user);
};

export const POST = async (request: Request, context: RouteContext) => {
  if (!MOCK_ENABLED) return mockDisabled();
  if (!hasMockAuthOrigin(request)) return mockError(403, ERROR_CODES.BAD_REQUEST, "请求来源不受信任");

  const { action } = await context.params;
  const refreshCookie = getMockRefreshCookie(request);

  try {
    switch (action) {
      case "register": {
        const input = RegisterInput.safeParse(await readJson(request));
        if (!input.success) return mockError(422, ERROR_CODES.VALIDATION_FAILED, "请检查注册信息", toFieldErrors(input.error));
        const key = IdempotencyKey.safeParse(request.headers.get("idempotency-key"));
        if (!key.success) return mockError(422, ERROR_CODES.VALIDATION_FAILED, "缺少有效的 Idempotency-Key");

        const result = await registerMockUser(input.data, key.data, refreshCookie);
        if (result.code === ERROR_CODES.EMAIL_TAKEN) return mockError(409, result.code, "邮箱已被注册");
        if (result.code === ERROR_CODES.IDEMPOTENCY_KEY_REUSED) {
          return mockError(422, result.code, "注册请求已提交，请重新操作");
        }
        return setRefreshCookie(mockOk(AuthResult, { ...result.access, user: result.user }, 201), result.refreshToken);
      }
      case "login": {
        const input = LoginInput.safeParse(await readJson(request));
        if (!input.success) return mockError(422, ERROR_CODES.VALIDATION_FAILED, "请检查登录信息", toFieldErrors(input.error));
        const result = await loginMockUser(input.data, refreshCookie);
        if (!result) return mockError(401, ERROR_CODES.INVALID_CREDENTIALS, "邮箱或密码错误");
        return setRefreshCookie(mockOk(AuthResult, { ...result.access, user: result.user }), result.refreshToken);
      }
      case "refresh": {
        const result = await refreshMockSession(refreshCookie);
        return result
          ? setRefreshCookie(mockOk(AccessTokenResult, result.access), result.refreshToken)
          : setRefreshCookie(mockError(401, ERROR_CODES.REFRESH_INVALID, "登录已失效，请重新登录"), "");
      }
      case "logout": {
        const user = await requireMockUser(request);
        if (user instanceof Response) return user;
        const input = LogoutInput.safeParse(await readJson(request, {}));
        if (!input.success) return mockError(422, ERROR_CODES.VALIDATION_FAILED, "请检查登出参数", toFieldErrors(input.error));
        if (!(await logoutMockSession(request, user.id, input.data.allDevices))) {
          return mockError(401, ERROR_CODES.TOKEN_INVALID, "登录会话已切换");
        }
        return setRefreshCookie(mockNoContent(), "");
      }
      default:
        return mockError(404, ERROR_CODES.BAD_REQUEST, "接口不存在");
    }
  } catch {
    return mockAuthUnavailable();
  }
};
