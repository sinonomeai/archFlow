import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authRoute from "../app/api/mock/auth/[action]/route";
import { GET as getProjects, POST as createProject } from "../app/api/mock/projects/route";
import { GET as getConversation } from "../app/api/mock/conversations/[conversationId]/route";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "test-password";
const FIRST_KEY = "6611ac35-7873-4c2e-a9a3-111ae6365efb";
const SECOND_KEY = "6611ac35-7873-4c2e-a9a3-111ae6365efc";

const request = (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers);
  if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
  if (options.body) headers.set("Content-Type", "application/json");
  return new Request(`${ORIGIN}/api/mock${path}`, { ...options, headers });
};

const auth = async (action: string, options: RequestInit = {}) => {
  const method = action === "me" ? "GET" : "POST";
  return authRoute[method](request(`/auth/${action}`, { ...options, method }), {
    params: Promise.resolve({ action }),
  });
};

const refreshCookie = (response: Response) => {
  const header = response.headers.get("set-cookie");
  expect(header).toContain("HttpOnly");
  expect(header).toContain("Secure");
  expect(header).toContain("SameSite=lax");
  expect(header).toContain("Path=/api/mock/auth");
  return header?.split(";")[0] ?? "";
};

const register = (email: string, key = FIRST_KEY) => auth("register", {
  headers: { "Idempotency-Key": key },
  body: JSON.stringify({ username: "Local user", email, password: PASSWORD }),
});

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "archflow-mock-test-"));
  vi.stubEnv("ARCHFLOW_MOCK_DIR", directory);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("local mock AC1", () => {
  it("does not return project rows without a bearer token", async () => {
    const response = await getProjects(request("/projects"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "TOKEN_MISSING", data: null });
  });

  it("registers, restores the session with a rotated cookie, then revokes it on logout", async () => {
    const registration = await register("  First@Example.COM ");
    expect(registration.status).toBe(201);
    const originalCookie = refreshCookie(registration);
    const { data: initial } = await registration.json();
    expect(initial).toMatchObject({ tokenType: "Bearer", user: { email: "first@example.com" } });
    expect(initial).not.toHaveProperty("refreshToken");

    const refreshed = await auth("refresh", { headers: { Cookie: originalCookie } });
    expect(refreshed.status).toBe(200);
    const nextCookie = refreshCookie(refreshed);
    expect(nextCookie).not.toBe(originalCookie);
    const { data: next } = await refreshed.json();
    expect(next.accessToken).not.toBe(initial.accessToken);
    const headers = { Authorization: `Bearer ${next.accessToken}`, Cookie: nextCookie };
    const me = await auth("me", { headers });
    expect(await me.json()).toMatchObject({ code: "OK", data: initial.user });

    const logout = await auth("logout", { headers, body: "" });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await auth("refresh", { headers })).status).toBe(401);
    expect((await auth("me", { headers })).status).toBe(401);
  });

  it("rejects cross-origin session writes and recognizes replay for the rotated session only", async () => {
    const registration = await register("owner@example.com");
    const originalCookie = refreshCookie(registration);
    const login = await auth("login", { body: JSON.stringify({ email: "owner@example.com", password: PASSWORD }) });
    const otherCookie = refreshCookie(login);
    const denied = await auth("refresh", { headers: { Cookie: originalCookie, Origin: "http://elsewhere.example" } });
    expect(denied.status).toBe(403);
    const rotatedCookie = refreshCookie(await auth("refresh", { headers: { Cookie: originalCookie } }));
    expect((await auth("refresh", { headers: { Cookie: originalCookie } })).status).toBe(401);
    expect((await auth("refresh", { headers: { Cookie: rotatedCookie } })).status).toBe(401);
    expect((await auth("refresh", { headers: { Cookie: otherCookie } })).status).toBe(200);
  });

  it("deduplicates concurrent registrations with the same submitted credentials", async () => {
    const [first, second] = await Promise.all([
      register("owner@example.com"),
      register("owner@example.com"),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const { data: firstRegistration } = await first.json();
    const { data: secondRegistration } = await second.json();
    expect(firstRegistration.user.id).toBe(secondRegistration.user.id);
  });

  it("keeps an unrelated current cookie when logout arrives with a stale bearer", async () => {
    const first = await register("first@example.com");
    const second = await register("second@example.com", SECOND_KEY);
    const { data: oldSession } = await first.json();
    const cookie = refreshCookie(second);
    const response = await auth("logout", { headers: { Authorization: `Bearer ${oldSession.accessToken}`, Cookie: cookie } });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await auth("refresh", { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it("isolates projects and conversations while preserving an unowned legacy database", async () => {
    const legacy = '{"projects":[],"files":[],"assets":[],"conversations":[]}';
    const legacyPath = join(directory, "db.json");
    await writeFile(legacyPath, legacy);
    const first = await register("first@example.com");
    const second = await register("second@example.com", SECOND_KEY);
    const { data: owner } = await first.json();
    const { data: outsider } = await second.json();
    const ownerHeaders = { Authorization: `Bearer ${owner.accessToken}` };
    const outsiderHeaders = { Authorization: `Bearer ${outsider.accessToken}` };
    const newProject = () => createProject(request("/projects", {
      method: "POST", headers: { ...ownerHeaders, "Idempotency-Key": FIRST_KEY },
      body: JSON.stringify({ name: "我的架构" }),
    }));

    const projectResponse = await newProject();
    expect(projectResponse.status).toBe(201);
    const { data: project } = await projectResponse.json();
    expect(await (await newProject()).json()).toMatchObject({ data: { id: project.id } });
    expect((await (await getProjects(request("/projects", { headers: ownerHeaders }))).json()).data.items).toHaveLength(1);
    expect((await (await getProjects(request("/projects", { headers: outsiderHeaders }))).json()).data.items).toEqual([]);

    const conversationId = project.lastActiveConversationId;
    const context = { params: Promise.resolve({ conversationId }) };
    expect((await getConversation(request(`/conversations/${conversationId}`, { headers: ownerHeaders }), context)).status).toBe(200);
    expect((await getConversation(request(`/conversations/${conversationId}`, { headers: outsiderHeaders }), context)).status).toBe(404);
    expect(await readFile(legacyPath, "utf8")).toBe(legacy);
  });
});
