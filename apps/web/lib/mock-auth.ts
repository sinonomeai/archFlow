import "server-only";

import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import path from "node:path";
import {
  ERROR_CODES,
  MockAccountId,
  MockAuthDatabase,
  type AccessTokenResult,
  type LoginInput,
  type MockAuthSession,
  type RegisterInput,
  type User,
} from "@arch-flow/shared";
import { getMockDir, readMockJson, withMockFileWrite, writeMockJson } from "./mock-files";
import { MOCK_ENABLED, mockDisabled, mockError } from "./mock-response";

const ACCESS_SECONDS = 15 * 60;
export const MOCK_REFRESH_SECONDS = 30 * 24 * 60 * 60;
export const MOCK_REFRESH_COOKIE = "archflow_mock_refresh";
export const MOCK_AUTH_PATH = "/api/mock/auth";
const REGISTRATION_KEY_MS = 24 * 60 * 60 * 1000;
const TOKEN_NONCE = /^[A-Za-z0-9_-]{43}$/;
const INVALID_PASSWORD_SALT = randomBytes(16).toString("hex");

type TokenKind = "access" | "refresh";

const getAuthPath = () => path.join(getMockDir(), "auth.json");
const emptyAuthDatabase = (): MockAuthDatabase => ({ accounts: [], sessions: [] });
const readAuthDatabase = () => readMockJson(getAuthPath(), MockAuthDatabase, emptyAuthDatabase);

const updateAuthDatabase = async <T>(mutate: (database: MockAuthDatabase) => T | Promise<T>): Promise<T> => {
  const filePath = getAuthPath();
  return withMockFileWrite(filePath, async () => {
    const database = await readMockJson(filePath, MockAuthDatabase, emptyAuthDatabase);
    const result = await mutate(database);
    await writeMockJson(filePath, MockAuthDatabase, database);
    return result;
  });
};

const hashPassword = (password: string, salt: string) =>
  new Promise<string>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "hex"), 64, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("hex"));
    });
  });

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const equal = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const sign = (value: string, session: MockAuthSession) =>
  createHmac("sha256", Buffer.from(session.signingKey, "hex")).update(value).digest("base64url");

const issueToken = (kind: TokenKind, session: MockAuthSession, expiresAt: number) => {
  const fields = `${kind}.${session.id}.${expiresAt}.${randomBytes(32).toString("base64url")}`;
  return `${fields}.${sign(fields, session)}`;
};

const verifyToken = (database: MockAuthDatabase, token: string, expectedKind: TokenKind) => {
  const [kind, sessionId, rawExpiry, nonce, signature, extra] = token.split(".");
  if (kind !== expectedKind || !MockAccountId.safeParse(sessionId).success || !rawExpiry ||
    !nonce || !TOKEN_NONCE.test(nonce) || !signature || !TOKEN_NONCE.test(signature) || extra !== undefined) {
    return null;
  }

  const expiresAt = Number(rawExpiry);
  if (!Number.isSafeInteger(expiresAt)) return null;

  const session = database.sessions.find((candidate) => candidate.id === sessionId);
  if (!session || !equal(sign(`${kind}.${sessionId}.${rawExpiry}.${nonce}`, session), signature)) {
    return null;
  }

  return { session, expiresAt };
};

const issueTokens = (session: MockAuthSession, now: number) => {
  session.refreshExpiresAt = now + MOCK_REFRESH_SECONDS * 1000;
  const refreshToken = issueToken("refresh", session, session.refreshExpiresAt);
  session.refreshHash = hashToken(refreshToken);

  const access: AccessTokenResult = {
    accessToken: issueToken("access", session, now + ACCESS_SECONDS * 1000),
    tokenType: "Bearer",
    expiresIn: ACCESS_SECONDS,
  };
  return { access, refreshToken };
};

const createSession = (database: MockAuthDatabase, userId: string, previousToken: string) => {
  const now = Date.now();
  const previous = verifyToken(database, previousToken, "refresh")?.session;
  const previousId = previous && equal(previous.refreshHash, hashToken(previousToken)) ? previous.id : undefined;
  database.sessions = database.sessions.filter(
    (session) => session.refreshExpiresAt > now && session.id !== previousId,
  );
  const session: MockAuthSession = {
    id: randomUUID(),
    userId,
    signingKey: randomBytes(32).toString("hex"),
    refreshHash: "",
    refreshExpiresAt: now,
  };
  database.sessions.push(session);
  return issueTokens(session, now);
};

export const getMockRefreshCookie = (request: Request) =>
  request.headers.get("cookie")?.split(";").map((entry) => entry.trim()).find(
    (entry) => entry.startsWith(`${MOCK_REFRESH_COOKIE}=`),
  )?.slice(MOCK_REFRESH_COOKIE.length + 1) ?? "";

export const hasMockAuthOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (origin !== null) return origin === expected;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
};

export const registerMockUser = (input: RegisterInput, key: string, previousToken: string) =>
  updateAuthDatabase(async (database) => {
    const now = Date.now();
    const accountByKey = database.accounts.find((account) => account.registrationKey === key &&
      account.registrationKeyExpiresAt > now);
    if (accountByKey) {
      const matchingHash = await hashPassword(input.password, accountByKey.passwordSalt);
      if (accountByKey.user.email !== input.email || accountByKey.user.username !== input.username ||
        !equal(accountByKey.passwordHash, matchingHash)) {
        return { code: ERROR_CODES.IDEMPOTENCY_KEY_REUSED } as const;
      }
      return {
        code: ERROR_CODES.OK,
        user: accountByKey.user,
        ...createSession(database, accountByKey.user.id, previousToken),
      } as const;
    }

    if (database.accounts.some((account) => account.user.email === input.email)) {
      return { code: ERROR_CODES.EMAIL_TAKEN } as const;
    }
    const passwordSalt = randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(input.password, passwordSalt);
    const user: User = {
      id: randomUUID(),
      username: input.username,
      email: input.email,
      avatarUrl: null,
      createdAt: new Date(now).toISOString(),
    };
    database.accounts.push({
      user,
      passwordSalt,
      passwordHash,
      registrationKey: key,
      registrationKeyExpiresAt: now + REGISTRATION_KEY_MS,
    });
    return { code: ERROR_CODES.OK, user, ...createSession(database, user.id, previousToken) } as const;
  });

export const loginMockUser = async (input: LoginInput, previousToken: string) => {
  const snapshot = await readAuthDatabase();
  const account = snapshot.accounts.find((candidate) => candidate.user.email === input.email);
  const passwordHash = await hashPassword(input.password, account?.passwordSalt ?? INVALID_PASSWORD_SALT);
  if (!account || !equal(account.passwordHash, passwordHash)) return null;

  return updateAuthDatabase((database) => ({
    user: account.user,
    ...createSession(database, account.user.id, previousToken),
  }));
};

export const refreshMockSession = async (token: string) => {
  if (!token) return null;

  return updateAuthDatabase((database) => {
    const verified = verifyToken(database, token, "refresh");
    const now = Date.now();
    if (!verified || verified.expiresAt <= now || verified.session.refreshExpiresAt <= now) return null;

    if (!equal(verified.session.refreshHash, hashToken(token))) {
      database.sessions = database.sessions.filter((session) => session.id !== verified.session.id);
      return null;
    }
    return issueTokens(verified.session, now);
  });
};

const readBearer = (request: Request) => request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];

export const logoutMockSession = async (request: Request, userId: string, allDevices: boolean) => {
  const bearer = readBearer(request);
  if (!bearer) return false;
  const refreshCookie = getMockRefreshCookie(request);

  return updateAuthDatabase((database) => {
    const access = verifyToken(database, bearer, "access");
    if (!access || access.session.userId !== userId) return false;

    if (refreshCookie) {
      const refresh = verifyToken(database, refreshCookie, "refresh");
      if (refresh?.session.id !== access.session.id) return false;
    }

    if (allDevices) {
      database.sessions = database.sessions.filter((session) => session.userId !== userId);
    } else {
      database.sessions = database.sessions.filter((session) => session.id !== access.session.id);
    }
    return true;
  });
};

export const mockAuthUnavailable = () => {
  console.error("Mock auth storage operation failed");
  return mockError(503, ERROR_CODES.SERVICE_UNAVAILABLE, "本地认证暂不可用，请重试");
};

export const requireMockUser = async (request: Request): Promise<User | Response> => {
  if (!MOCK_ENABLED) return mockDisabled();

  const bearer = readBearer(request);
  if (!bearer) {
    return request.headers.has("authorization")
      ? mockError(401, ERROR_CODES.TOKEN_INVALID, "登录凭据无效")
      : mockError(401, ERROR_CODES.TOKEN_MISSING, "请先登录");
  }

  try {
    const database = await readAuthDatabase();
    const verified = verifyToken(database, bearer, "access");
    const now = Date.now();
    if (!verified || verified.session.refreshExpiresAt <= now) {
      return mockError(401, ERROR_CODES.TOKEN_INVALID, "登录凭据无效");
    }
    if (verified.expiresAt <= now) {
      return mockError(401, ERROR_CODES.TOKEN_EXPIRED, "访问令牌已过期");
    }
    return database.accounts.find((account) => account.user.id === verified.session.userId)?.user ??
      mockError(401, ERROR_CODES.TOKEN_INVALID, "登录凭据无效");
  } catch {
    return mockAuthUnavailable();
  }
};
