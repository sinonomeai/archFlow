import { NextResponse, type NextRequest } from "next/server";
import { SESSION_HINT_COOKIE } from "@/lib/session";

const PROTECTED_PATHS = ["/", "/workspace"];

export const middleware = (request: NextRequest) => {
  if (process.env.MOCK_API === "1") return NextResponse.next();
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.get(SESSION_HINT_COOKIE)?.value === "1";
  const isProtected = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL("/workspace", request.url));
  }

  return NextResponse.next();
};

export const config = {
  matcher: ["/", "/login", "/workspace", "/workspace/:path*"],
};
