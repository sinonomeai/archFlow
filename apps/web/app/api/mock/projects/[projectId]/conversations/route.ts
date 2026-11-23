import { z } from "zod";
import {
  Conversation,
  CreateConversationInput,
  ERROR_CODES,
} from "@arch-flow/shared";
import { requireMockUser } from "@/lib/mock-auth";
import { createConversation } from "@/lib/mock-db";
import {
  mockError,
  mockOk,
  toFieldErrors,
} from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export const POST = async (request: Request, context: RouteContext) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  try {
    const { projectId } = await context.params;
    const body: unknown = request.body === null ? {} : await request.json();
    const input = CreateConversationInput.parse(body);
    const result = await createConversation(user.id, projectId, input);

    if (result.status === "project_not_found") {
      return mockError(404, ERROR_CODES.PROJECT_NOT_FOUND, "项目不存在");
    }

    if (result.status === "asset_not_found") {
      return mockError(404, ERROR_CODES.ASSET_NOT_FOUND, "资产不存在");
    }

    return mockOk(Conversation, result.conversation, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return mockError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        "请求参数不合法",
        toFieldErrors(error),
      );
    }
    if (error instanceof SyntaxError) return mockError(400, ERROR_CODES.BAD_REQUEST, "请求不是有效的 JSON");

    throw error;
  }
};
