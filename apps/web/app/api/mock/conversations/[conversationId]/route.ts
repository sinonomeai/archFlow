import { z } from "zod";
import {
  Conversation,
  ERROR_CODES,
  UpdateConversationInput,
} from "@arch-flow/shared";
import { requireMockUser } from "@/lib/mock-auth";
import {
  deleteConversation,
  getConversation,
  renameConversation,
} from "@/lib/mock-db";
import {
  mockError,
  mockNoContent,
  mockOk,
  toFieldErrors,
} from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export const GET = async (request: Request, context: RouteContext) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  const { conversationId } = await context.params;
  const conversation = await getConversation(user.id, conversationId);

  if (!conversation) {
    return mockError(
      404,
      ERROR_CODES.CONVERSATION_NOT_FOUND,
      "会话不存在",
    );
  }

  return mockOk(Conversation, conversation);
};

export const PATCH = async (request: Request, context: RouteContext) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  try {
    const { conversationId } = await context.params;
    const body: unknown = await request.json();
    const input = UpdateConversationInput.parse(body);
    const conversation = await renameConversation(user.id, conversationId, input.title);

    if (!conversation) {
      return mockError(
        404,
        ERROR_CODES.CONVERSATION_NOT_FOUND,
        "会话不存在",
      );
    }

    return mockOk(Conversation, conversation);
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

export const DELETE = async (request: Request, context: RouteContext) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  const { conversationId } = await context.params;
  const deleted = await deleteConversation(user.id, conversationId);

  if (!deleted) {
    return mockError(
      404,
      ERROR_CODES.CONVERSATION_NOT_FOUND,
      "会话不存在",
    );
  }

  return mockNoContent();
};
