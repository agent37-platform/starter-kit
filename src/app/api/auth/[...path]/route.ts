import { BACKEND } from "@/lib/backend";

// Neon Auth's API proxy (sign-up, sign-in, sessions, password reset). Only mounted on the Neon
// backend; on Supabase the browser talks to Supabase Auth directly and this path is a 404.
type Ctx = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function dispatch(method: Method, request: Request, ctx: Ctx): Promise<Response> {
  if (BACKEND !== "neon") return new Response("Not found", { status: 404 });
  const { neonAuth } = await import("@/lib/neon/auth");
  return neonAuth().handler()[method](request, ctx);
}

export const GET = (request: Request, ctx: Ctx) => dispatch("GET", request, ctx);
export const POST = (request: Request, ctx: Ctx) => dispatch("POST", request, ctx);
export const PUT = (request: Request, ctx: Ctx) => dispatch("PUT", request, ctx);
export const PATCH = (request: Request, ctx: Ctx) => dispatch("PATCH", request, ctx);
export const DELETE = (request: Request, ctx: Ctx) => dispatch("DELETE", request, ctx);
