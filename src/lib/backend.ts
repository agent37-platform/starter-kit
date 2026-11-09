// Which backend the app runs on: "supabase" (default) or "neon". NEXT_PUBLIC_ so the browser-side
// auth calls (src/lib/auth-client.ts) and the server agree; Next.js inlines it at build time, so
// changing it means restarting `npm run dev` / redeploying. Set by `npm run setup` / `setup:neon`.
export type Backend = "supabase" | "neon";

export const BACKEND: Backend = process.env.NEXT_PUBLIC_BACKEND === "neon" ? "neon" : "supabase";
