import { z } from "zod";
import {
  CreateProjectInput,
  ERROR_CODES,
  IdempotencyKey,
  PageSchema,
  ProjectNode,
} from "@arch-flow/shared";
import { requireMockUser } from "@/lib/mock-auth";
import { createProject, listProjectNodes } from "@/lib/mock-db";
import {
  mockError,
  mockOk,
  toFieldErrors,
} from "@/lib/mock-response";

export const dynamic = "force-dynamic";

const projectPageSchema = PageSchema(ProjectNode);

export const GET = async (request: Request) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  const items = await listProjectNodes(user.id);

  return mockOk(projectPageSchema, {
    items,
    nextCursor: null,
    hasMore: false,
  });
};

export const POST = async (request: Request) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  const key = IdempotencyKey.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) return mockError(422, ERROR_CODES.VALIDATION_FAILED, "缺少有效的 Idempotency-Key");

  try {
    const body: unknown = await request.json();
    const input = CreateProjectInput.parse(body);
    const project = await createProject(user.id, input, key.data);
    if (!project) return mockError(422, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, "项目创建请求已提交，请重新操作");

    return mockOk(ProjectNode, project, 201);
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
