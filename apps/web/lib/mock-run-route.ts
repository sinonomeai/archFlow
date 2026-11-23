import "server-only";

import { ERROR_CODES } from "@arch-flow/shared";
import { z } from "zod";
import { requireMockUser } from "./mock-auth";
import {
  MOCK_ENABLED,
  mockDisabled,
  mockError,
  toFieldErrors,
} from "./mock-response";
import { MockRunError } from "./mock-run-data";

export const handleMockRunRoute = async (
  request: Request,
  handler: (userId: string) => Promise<Response>,
): Promise<Response> => {
  if (!MOCK_ENABLED) return mockDisabled();
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  try {
    return await handler(user.id);
  } catch (error) {
    if (error instanceof MockRunError)
      return mockError(error.status, error.code, error.message);
    if (error instanceof z.ZodError) {
      return mockError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "请求参数不合法",
        toFieldErrors(error),
      );
    }
    console.error("本地运行请求失败", error);
    return mockError(
      500,
      ERROR_CODES.INTERNAL_ERROR,
      "本地数据读取或保存失败，请重试。",
    );
  }
};
