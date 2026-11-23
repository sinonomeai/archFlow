import { Id, MockActiveRun } from "@arch-flow/shared";
import { mockOk } from "@/lib/mock-response";
import { handleMockRunRoute } from "@/lib/mock-run-route";
import { getMockRunRuntime } from "@/lib/preview-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

export const GET = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const conversationId = Id.parse((await params).conversationId);
    const active = await getMockRunRuntime().active(userId, conversationId);
    return mockOk(MockActiveRun, active);
  });
