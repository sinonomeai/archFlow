import {
  ERROR_CODES,
  Id,
  IdempotencyKey,
  Message,
  MessageListQuery,
  MockRunAccepted,
  MockSendMessageInput,
  PageSchema,
} from "@arch-flow/shared";
import { listMessages } from "@/lib/mock-db";
import { mockError, mockOk } from "@/lib/mock-response";
import { handleMockRunRoute } from "@/lib/mock-run-route";
import { getMockRunRuntime } from "@/lib/preview-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };
const messagePageSchema = PageSchema(Message);

export const GET = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const conversationId = Id.parse((await params).conversationId);
    const query = MessageListQuery.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const page = await listMessages(userId, conversationId, query);
    return page
      ? mockOk(messagePageSchema, page)
      : mockError(404, ERROR_CODES.CONVERSATION_NOT_FOUND, "会话不存在");
  });

export const POST = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const conversationId = Id.parse((await params).conversationId);
    const key = IdempotencyKey.safeParse(
      request.headers.get("Idempotency-Key"),
    );
    if (!key.success) {
      return mockError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        "缺少有效的 Idempotency-Key",
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return mockError(400, ERROR_CODES.BAD_REQUEST, "请求不是合法的 JSON");
    }
    const input = MockSendMessageInput.parse(body);
    const accepted = await getMockRunRuntime().accept(
      userId,
      conversationId,
      input,
      key.data,
    );
    return mockOk(MockRunAccepted, accepted, 202);
  });
