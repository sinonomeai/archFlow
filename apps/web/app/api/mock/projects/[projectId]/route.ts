import { ERROR_CODES } from "@arch-flow/shared";
import { requireMockUser } from "@/lib/mock-auth";
import { deleteProject } from "@/lib/mock-db";
import { mockError, mockNoContent } from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export const DELETE = async (request: Request, context: RouteContext) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  const { projectId } = await context.params;
  const deleted = await deleteProject(user.id, projectId);

  if (!deleted) {
    return mockError(404, ERROR_CODES.PROJECT_NOT_FOUND, "项目不存在");
  }

  return mockNoContent();
};
