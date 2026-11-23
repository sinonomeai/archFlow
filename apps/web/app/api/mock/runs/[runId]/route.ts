import { Id, MockRunSnapshot } from "@arch-flow/shared";
import { mockOk } from "@/lib/mock-response";
import { handleMockRunRoute } from "@/lib/mock-run-route";
import { getMockRunRuntime } from "@/lib/preview-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ runId: string }> };

export const GET = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const runId = Id.parse((await params).runId);
    const snapshot = await getMockRunRuntime().snapshot(userId, runId);
    return mockOk(MockRunSnapshot, snapshot);
  });
