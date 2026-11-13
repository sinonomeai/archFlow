import { HttpStatus, Injectable } from "@nestjs/common";
import { compare, hash } from "bcryptjs";
import {
  ERROR_CODES,
  type AccessTokenResult,
  type AuthResult,
  type LoginInput,
  type RegisterInput,
  type User,
} from "@arch-flow/shared";
import { UserEntity } from "@arch-flow/db";
import { apiError } from "../../common/api-error.js";
import type { AuthUser } from "../../common/request-context.js";
import { DatabaseService } from "../../database/database.service.js";
import { loadEnv } from "../../config/env.js";
import { TokenService } from "./token.service.js";

export type AuthSession = {
  result: AuthResult;
  refreshToken: string;
};

export type RefreshSession = {
  result: AccessTokenResult;
  refreshToken: string;
};

const toUser = (user: UserEntity): User => ({
  id: user.uuid,
  username: user.username,
  email: user.email,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt.toISOString(),
});

const toAuthUser = (user: UserEntity): AuthUser => ({
  internalId: user.id,
  uuid: user.uuid,
  email: user.email,
  username: user.username,
  avatarUrl: user.avatarUrl,
  createdAt: user.createdAt,
});

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: TokenService,
  ) {}

  private readonly repository = () =>
    this.database.dataSource.getRepository(UserEntity);

  register = async (input: RegisterInput): Promise<AuthSession> => {
    const existing = await this.repository().findOneBy({ email: input.email });

    if (existing) {
      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.EMAIL_TAKEN,
        "该邮箱已被注册",
      );
    }

    const user = this.repository().create({
      email: input.email,
      username: input.username,
      passwordHash: await hash(input.password, 12),
      avatarUrl: null,
    });

    try {
      await this.repository().save(user);
    } catch (error) {
      /** 并发注册时唯一索引是最终防线。 */
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        throw apiError(
          HttpStatus.CONFLICT,
          ERROR_CODES.EMAIL_TAKEN,
          "该邮箱已被注册",
        );
      }

      throw error;
    }

    return this.createSession(user);
  };

  login = async (input: LoginInput): Promise<AuthSession> => {
    const user = await this.repository().findOneBy({ email: input.email });

    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.INVALID_CREDENTIALS,
        "邮箱或密码错误",
      );
    }

    return this.createSession(user);
  };

  refresh = async (token: string): Promise<RefreshSession> => {
    const { userUuid, refreshToken } =
      await this.tokens.rotateRefreshToken(token);
    const user = await this.repository().findOneBy({ uuid: userUuid });

    if (!user) {
      throw apiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.REFRESH_INVALID,
        "刷新令牌已失效，请重新登录",
      );
    }

    return {
      result: {
        accessToken: this.tokens.signAccessToken(user.uuid),
        tokenType: "Bearer",
        expiresIn: loadEnv().JWT_ACCESS_TTL_SECONDS,
      },
      refreshToken,
    };
  };

  logout = async (
    user: AuthUser,
    refreshToken: string | undefined,
    allDevices: boolean,
  ): Promise<void> => {
    if (allDevices) {
      await this.tokens.revokeAllRefreshTokens(user.uuid);
      return;
    }

    if (refreshToken) {
      await this.tokens.revokeRefreshToken(refreshToken);
    }
  };

  me = (user: AuthUser): User => ({
    id: user.uuid,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  });

  loadAuthUser = async (userUuid: string): Promise<AuthUser | null> => {
    const user = await this.repository().findOneBy({ uuid: userUuid });

    return user ? toAuthUser(user) : null;
  };

  private readonly createSession = async (
    user: UserEntity,
  ): Promise<AuthSession> => ({
    result: {
      accessToken: this.tokens.signAccessToken(user.uuid),
      tokenType: "Bearer",
      expiresIn: loadEnv().JWT_ACCESS_TTL_SECONDS,
      user: toUser(user),
    },
    refreshToken: await this.tokens.issueRefreshToken(user.uuid),
  });
}
