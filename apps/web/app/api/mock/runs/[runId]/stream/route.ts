import { Id, MockStreamCursor } from "@arch-flow/shared";
import { handleMockRunRoute } from "@/lib/mock-run-route";
import { getMockRunRuntime } from "@/lib/preview-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ runId: string }> };

export const GET = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const runId = Id.parse((await params).runId);
    const cursor = request.headers.get("Last-Event-ID");
    return getMockRunRuntime().stream(
      userId,
      runId,
      cursor === null ? undefined : MockStreamCursor.parse(cursor),
      request.signal,
    );
  });
