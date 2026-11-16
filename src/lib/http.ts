import { NextResponse } from "next/server";
import { Agent37Error } from "@/lib/agent37";
import { BackofficeError } from "@/lib/backoffice";
import { TenantError } from "@/lib/tenant-resolver";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** JSON that no browser or proxy keeps: what is personal and changes. */
export function noStore<T>(data: T): NextResponse {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export function apiError(message: string, status = 400, code = "error") {
  return NextResponse.json({ error: { code, message } }, { status });
}

// A database refusal: its message names tables and constraints, so it goes to the server log and
// the member gets a plain sentence.
export function dbError(error: { message: string }, status = 500): ApiError {
  console.error("[db]", error.message);
  return new ApiError(status, status === 500 ? "db_error" : "invalid_request", "Une erreur est survenue. Réessayez dans un instant.");
}

// What a member reads when Agent37 refuses or fails. Its own messages are in English and written
// for the operator ("payment required — fund your wallet…"): they go to the server log, and the
// member gets one of these.
function agent37Message(status: number): string {
  if (status === 404) return "Cet élément est introuvable.";
  if (status === 409) return "Une autre opération est en cours. Réessayez dans un instant.";
  if (status === 429) return "Trop de demandes à la fois. Réessayez dans un instant.";
  if (status === 400 || status === 422) return "Cette demande n’a pas pu être traitée.";
  return "Le service est momentanément indisponible. Réessayez dans un instant.";
}

export function handleError(e: unknown) {
  // Written in this app, or by the back office: already a sentence for the member, in French.
  if (e instanceof ApiError || e instanceof BackofficeError || e instanceof TenantError) {
    return apiError(e.message, e.status, e.code);
  }
  if (e instanceof Agent37Error) {
    console.error(`[agent37] ${e.status} ${e.code}`, e.message);
    // Our key's refusals (401, 403), an unfunded wallet (402) and Agent37's own failures are not
    // the member's doing: all read as an outage.
    const status = [400, 404, 409, 422, 429].includes(e.status) ? e.status : 502;
    return apiError(agent37Message(status), status, e.code);
  }
  console.error("[api]", e);
  return apiError("Une erreur est survenue. Réessayez dans un instant.", 500, "internal_error");
}
