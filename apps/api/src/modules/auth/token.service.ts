import { HttpStatus, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { ERROR_CODES } from "@arch-flow/shared";
import { apiError } from "../../common/api-error.js";
import { loadEnv } from "../../config/env.js";
import { RedisService } from "../../infra/redis.service.js";

type AccessPayload = {
  sub: string;
};

export type RefreshRecord = {
  userUuid: string;
};

const ISSUER = "arch-flow";
const AUDIENCE = "arch-flow-web";

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * 双 Token：
 * - accessToken 为 JWT，短效，前端内存持有；
 * - refreshToken 为不透明随机串，只存 hash 于 Redis，通过 httpOnly Cookie 下发。
 */
@Injectable()
export class TokenService {
  constructor(private readonly redis: RedisService) {}

  signAccessToken = (userUuid: string): string => {
    const env = loadEnv();

    return jwt.sign({ sub: userUuid }, env.JWT_SECRET, {
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  };

  verifyAccessToken = (token: string): { userUuid: string } => {
    const env = loadEnv();

    try {
      const payload = jwt.verify(token, env.JWT_SECRET, {
        issuer: ISSUER,
        audience: AUDIENCE,
      });

      if (
        typeof payload !== "object" ||
        payload === null ||
        typeof (payload as AccessPayload).sub !== "string"
      ) {
        throw apiError(
          HttpStatus.UNAUTHORIZED,
          ERROR_CODES.TOKEN_INVALID,
          "Access Token 无效",
        );
      }

      return { userUuid: (payload as AccessPayload).sub };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw apiError(
          HttpStatus.UNAUTHORIZED,
          ERROR_CODES.TOKEN_EXPIRED,
          "登录已过期",
        );
      }

      if (error instanceof Error && "status" in error) {
        throw error;
      }

      throw apiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.TOKEN_INVALID,
        "Access Token 无效",
      );
    }
  };

  issueRefreshToken = async (userUuid: string): Promise<string> => {
    const env = loadEnv();
    const token = `rt_${randomBytes(32).toString("base64url")}`;
    const hash = hashToken(token);
    const key = this.tokenKey(hash);
    const userKey = this.userKey(userUuid);

    await this.redis.client
      .multi()
      .set(key, JSON.stringify({ userUuid } satisfies RefreshRecord), "EX", env.JWT_REFRESH_TTL_SECONDS)
      .sadd(userKey, hash)
      .expire(userKey, env.JWT_REFRESH_TTL_SECONDS)
      .exec();

    return token;
  };

  /** 一次性轮转；检测到旧 token 复用则吊销该用户全部 refreshToken。 */
  rotateRefreshToken = async (
    token: string,
  ): Promise<{ userUuid: string; refreshToken: string }> => {
    const hash = hashToken(token);
    const raw = await this.redis.client.get(this.tokenKey(hash));

    if (!raw) {
      /** 命中 used 记录说明旧 token 被复用：按安全策略吊销整族。 */
      const reusedBy = await this.redis.client.get(this.usedKey(hash));

      if (reusedBy) {
        await this.revokeAllRefreshTokens(reusedBy);
      }

      throw apiError(
        HttpStatus.UNAUTHORIZED,
        ERROR_CODES.REFRESH_INVALID,
        "刷新令牌已失效，请重新登录",
      );
    }

    const record = JSON.parse(raw) as RefreshRecord;
    const env = loadEnv();

    await this.redis.client
      .multi()
      .del(this.tokenKey(hash))
      .srem(this.userKey(record.userUuid), hash)
      .set(this.usedKey(hash), record.userUuid, "EX", env.JWT_REFRESH_TTL_SECONDS)
      .exec();

    const refreshToken = await this.issueRefreshToken(record.userUuid);

    return { userUuid: record.userUuid, refreshToken };
  };

  revokeRefreshToken = async (token: string): Promise<void> => {
    const hash = hashToken(token);
    const raw = await this.redis.client.get(this.tokenKey(hash));

    if (!raw) {
      return;
    }

    const record = JSON.parse(raw) as RefreshRecord;

    await this.redis.client
      .multi()
      .del(this.tokenKey(hash))
      .srem(this.userKey(record.userUuid), hash)
      .exec();
  };

  revokeAllRefreshTokens = async (userUuid: string): Promise<void> => {
    const userKey = this.userKey(userUuid);
    const hashes = await this.redis.client.smembers(userKey);

    if (hashes.length === 0) {
      return;
    }

    const multi = this.redis.client.multi();

    for (const hash of hashes) {
      multi.del(this.tokenKey(hash));
    }

    multi.del(userKey);
    await multi.exec();
  };

  private readonly tokenKey = (hash: string): string =>
    `auth:refresh:token:${hash}`;

  private readonly userKey = (userUuid: string): string =>
    `auth:refresh:user:${userUuid}`;

  private readonly usedKey = (hash: string): string =>
    `auth:refresh:used:${hash}`;
}
