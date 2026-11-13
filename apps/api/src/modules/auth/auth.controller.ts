import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  ERROR_CODES,
  LoginInput,
  LogoutInput,
  RegisterInput,
  type AccessTokenResult,
  type AuthResult,
  type User,
} from "@arch-flow/shared";
import { apiError } from "../../common/api-error.js";
import { Public, RawResponse } from "../../common/decorators.js";
import type { AuthUser } from "../../common/request-context.js";
import { CurrentUser } from "../../common/request-context.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { loadEnv } from "../../config/env.js";
import type { AuthSession } from "./auth.service.js";
import { AuthService } from "./auth.service.js";

const REFRESH_COOKIE = "refreshToken";

const refreshCookieOptions = () => {
  const env = loadEnv();

  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/v1/auth",
    maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
  };
};

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(RegisterInput)) input: RegisterInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const session = await this.auth.register(input);
    this.setRefreshCookie(response, session);

    return session.result;
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginInput)) input: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const session = await this.auth.login(input);
    this.setRefreshCookie(response, session);

    return session.result;
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResult> {
    const token = this.readRefreshCookie(request);

    if (!token) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.REFRESH_INVALID,
        "刷新令牌缺失，请重新登录",
      );
    }

    const session = await this.auth.refresh(token);
    response.cookie(
      REFRESH_COOKIE,
      session.refreshToken,
      refreshCookieOptions(),
    );

    return session.result;
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RawResponse()
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(LogoutInput.default({ allDevices: false })))
    input: LogoutInput,
  ): Promise<void> {
    await this.auth.logout(
      user,
      this.readRefreshCookie(request),
      input.allDevices,
    );

    response.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  }

  @Get("me")
  async me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.me(user);
  }

  private setRefreshCookie(response: Response, session: AuthSession): void {
    response.cookie(
      REFRESH_COOKIE,
      session.refreshToken,
      refreshCookieOptions(),
    );
  }

  private readRefreshCookie(request: Request): string | undefined {
    const value = (request.cookies as Record<string, unknown> | undefined)?.[
      REFRESH_COOKIE
    ];

    return typeof value === "string" ? value : undefined;
  }
}
