import { ERROR_CODES } from "@arch-flow/shared";
import { requireMockUser } from "@/lib/mock-auth";
import { deleteFile } from "@/lib/mock-db";
import { mockError, mockNoContent } from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string; fileId: string }>;
};

export const DELETE = async (request: Request, context: RouteContext) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  const { projectId, fileId } = await context.params;
  const deleted = await deleteFile(user.id, projectId, fileId);

  if (!deleted) {
    return mockError(404, ERROR_CODES.FILE_NOT_FOUND, "文件不存在");
  }

  return mockNoContent();
};
