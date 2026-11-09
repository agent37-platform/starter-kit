import { NextResponse, type NextRequest } from "next/server";
import { BACKEND } from "@/lib/backend";
import { updateSession } from "@/lib/supabase/middleware";
import { neonAuth } from "@/lib/neon/auth";

// Routes a signed-out visitor may open. Shared by both backends so they can't drift.
const PUBLIC_ROUTES = ["/", "/login", "/auth", "/reset-password", "/invite"];

let neonMiddleware: ((request: NextRequest) => Promise<NextResponse>) | null = null;

// Neon Auth's middleware validates/refreshes the session cookie and redirects signed-out requests
// to /login. It doesn't carry the requested path, so add ?next= the way the Supabase path does.
async function neonSession(request: NextRequest) {
  neonMiddleware ??= neonAuth().middleware({ loginUrl: "/login", publicRoutes: PUBLIC_ROUTES });
  const response = await neonMiddleware(request);
  const location = response.headers.get("location");
  if (location) {
    const url = new URL(location, request.url);
    if (url.pathname === "/login" && !url.searchParams.has("next")) {
      url.searchParams.set("next", request.nextUrl.pathname);
      response.headers.set("location", url.toString());
    }
  }
  return response;
}

export async function proxy(request: NextRequest) {
  return BACKEND === "neon" ? neonSession(request) : updateSession(request, PUBLIC_ROUTES);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
