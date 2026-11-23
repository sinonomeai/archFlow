import { afterEach, beforeEach, expect, it, vi } from "vitest";

const USER = {
  id: "6611ac35-7873-4c2e-a9a3-111ae6365efb",
  username: "Local user",
  email: "local@example.com",
  avatarUrl: null,
  createdAt: "2026-11-23T10:00:00.000Z",
};

const ok = (data: unknown) => Response.json({ code: "OK", message: "", traceId: "trace", data });
const failure = (code: string) => Response.json({ code, message: "登录失效", traceId: "trace", data: null }, { status: 401 });
const token = (accessToken: string) => ({ accessToken, tokenType: "Bearer", expiresIn: 900 });

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("location", new URL("http://localhost:3000"));
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, work: () => Promise<unknown>) => work() } });
});

afterEach(() => vi.unstubAllGlobals());

it("coalesces expired requests and replays each once with the original request identity", async () => {
  const calls: { input: string; header: string | null; key: string | null; body?: BodyInit | null; signal?: AbortSignal | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ input: new URL(input).pathname, header: headers.get("authorization"), key: headers.get("idempotency-key"), body: init?.body, signal: init?.signal });
    if (input.endsWith("/login")) return ok({ ...token("first"), user: USER });
    if (input.endsWith("/refresh")) return ok(token("second"));
    if (input.endsWith("/me")) return ok(USER);
    return headers.get("authorization") === "Bearer second" ? ok({ accepted: true }) : failure("TOKEN_EXPIRED");
  }));

  const client = await import("../preview/lib/api-client");
  expect(client.authenticatedFetch, "authenticated fetch should exist").toBeTypeOf("function");
  await client.signIn({ email: USER.email, password: "test-password" });
  const call = { method: "POST", headers: { "Idempotency-Key": USER.id }, body: '{"name":"My project"}', signal: new AbortController().signal };
  const path = "/api/mock/projects";
  const results = await Promise.all([client.authenticatedFetch(path, call), client.authenticatedFetch(path, call)]);
  expect(results.map((response) => response.status)).toEqual([200, 200]);
  expect(calls.filter(({ input }) => input.endsWith("/refresh"))).toHaveLength(1);
  expect(calls.filter(({ input }) => input === path)).toEqual([
    ...Array.from({ length: 2 }, () => ({ input: path, header: "Bearer first", key: USER.id, body: call.body, signal: call.signal })),
    ...Array.from({ length: 2 }, () => ({ input: path, header: "Bearer second", key: USER.id, body: call.body, signal: call.signal })),
  ]);
});

it("never sends the bearer across origins and does not refresh a missing or invalid token", async () => {
  const fetcher = vi.fn(async (input: string) => {
    if (input.endsWith("/login")) return ok({ ...token("first"), user: USER });
    return failure("TOKEN_INVALID");
  });
  vi.stubGlobal("fetch", fetcher);
  const client = await import("../preview/lib/api-client");
  expect(client.authenticatedFetch, "authenticated fetch should exist").toBeTypeOf("function");
  await client.signIn({ email: USER.email, password: "test-password" });
  await expect(client.authenticatedFetch("https://elsewhere.example/api/mock/projects")).rejects.toThrow();
  const response = await client.authenticatedFetch("/api/mock/projects");
  expect(response.status).toBe(401);
  expect(fetcher.mock.calls).toEqual([
    ["http://localhost:3000/api/mock/auth/login", expect.anything()],
    ["http://localhost:3000/api/mock/projects", expect.anything()],
  ]);
});
