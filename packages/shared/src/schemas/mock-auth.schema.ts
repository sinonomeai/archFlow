import { z } from "zod";
import { User } from "./auth.schema.js";

export const MockAccountId = z.uuid();

export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

const mockAuthAccount = z.object({
  user: User.extend({ id: MockAccountId }),
  passwordSalt: z.string(),
  passwordHash: z.string(),
  registrationKey: IdempotencyKey,
  registrationKeyExpiresAt: z.number(),
});
export type MockAuthAccount = z.infer<typeof mockAuthAccount>;

const mockAuthSession = z.object({
  id: MockAccountId,
  userId: MockAccountId,
  signingKey: z.string(),
  refreshHash: z.string(),
  refreshExpiresAt: z.number(),
});
export type MockAuthSession = z.infer<typeof mockAuthSession>;

export const MockAuthDatabase = z.object({
  accounts: z.array(mockAuthAccount),
  sessions: z.array(mockAuthSession),
});
export type MockAuthDatabase = z.infer<typeof MockAuthDatabase>;
