import { ERROR_CODES } from "@arch-flow/shared";
import { requireMockUser } from "@/lib/mock-auth";
import { deleteAsset } from "@/lib/mock-db";
import { mockError, mockNoContent } from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

export const DELETE = async (request: Request, context: RouteContext) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  const { projectId, assetId } = await context.params;
  const deleted = await deleteAsset(user.id, projectId, assetId);

  if (!deleted) {
    return mockError(404, ERROR_CODES.ASSET_NOT_FOUND, "资产不存在");
  }

  return mockNoContent();
};
