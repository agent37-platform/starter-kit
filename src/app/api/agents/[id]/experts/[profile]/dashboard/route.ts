import { backoffice, BackofficeError, type BoDashboardShareView, type DashboardShareMode } from "@/lib/backoffice";
import { shareForBrowser, shareUrlOf } from "@/lib/dashboard-share";
import { agent37, instanceFetch } from "@/lib/agent37";
import { requireAgentAccess } from "@/lib/auth";
import { fetchCachedDashboardState } from "@/lib/dashboard-cache";
import { filesAndLink } from "@/lib/dashboard-link";
import { expertDriveFolders } from "@/lib/expert-folders";
import { getDashboardMeta, isTrustedDashboardUrl } from "@/lib/dashboards";
import { JSON_TIMEOUT_MS, withTimeout } from "@/lib/fetch-timeout";
import { memo } from "@/lib/memo";
import { ApiError, handleError, json, readJson } from "@/lib/http";
import { authViaBackoffice } from "@/lib/runtime-config";
import { readSession } from "@/lib/session";
import { pinnedWorkspaceId } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string; profile: string }> };

const MODES: readonly DashboardShareMode[] = ["team", "people", "link"];

/** The owner's back-office session; sharing is the back office's, so without it there is none. */
async function shareToken(): Promise<string> {
  const session = authViaBackoffice() ? await readSession() : null;
  if (!session) throw new ApiError(404, "not_found", "Le partage n’est pas disponible ici.");
  return session.accessToken;
}

async function shareAnswer(view: BoDashboardShareView | null) {
  return { ...shareForBrowser(view), shareUrl: shareUrlOf(await pinnedWorkspaceId().catch(() => undefined), view) };
}

// What the instance holds for a dashboard: its link, files and the team view. Kept a few seconds,
// so the generation poll and several tabs share one reading; longer once the link is there.
interface InstanceView {
  lien: string | null;
  hebergeur: string;
  maj: string | null;
  pdfPath: string | null;
  htmlPath: string | null;
  pptxPath: string | null;
  teamViewLien: string | null;
}
const views = memo<InstanceView>({ ttlMs: 30_000, ttlOf: (v) => (v.lien ? 30_000 : 5_000), maxEntries: 500, maxFlightMs: 60_000 });
const MAX_SUBFOLDERS = 8;

const trusted = (url: unknown): string | null => (isTrustedDashboardUrl(url) ? url.trim() : null);

async function readJsonFile(id: string, path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await instanceFetch(id, `/v1/files/content?path=${encodeURIComponent(path)}`, withTimeout(undefined, JSON_TIMEOUT_MS));
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const parsed = JSON.parse(await res.text()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const listOrEmpty = (id: string, dir: string) => agent37.listFiles(id, dir).then((r) => r.entries ?? [], () => []);

// The first PDF, HTML and PowerPoint found, folders in order, a folder's sub-folders in place of it.
async function deliverableFiles(id: string, dirs: string[]): Promise<Pick<InstanceView, "pdfPath" | "htmlPath" | "pptxPath">> {
  const levels = await Promise.all(dirs.map((d) => listOrEmpty(id, d)));
  const subdirs = levels.flatMap((entries, i) => entries.filter((e) => e.type === "directory" && e.name !== "archives").map((e) => `${dirs[i]}/${e.name}`)).slice(0, MAX_SUBFOLDERS);
  const nested = new Map((await Promise.all(subdirs.map(async (d) => [d, await listOrEmpty(id, d)] as const))));
  const out = { pdfPath: null as string | null, htmlPath: null as string | null, pptxPath: null as string | null };
  const take = (name: string, path: string) => {
    const n = name.toLowerCase();
    if (!out.pdfPath && n.endsWith(".pdf")) out.pdfPath = path;
    if (!out.htmlPath && n.endsWith(".html")) out.htmlPath = path;
    if (!out.pptxPath && n.endsWith(".pptx")) out.pptxPath = path;
  };
  levels.forEach((entries, i) => {
    for (const entry of entries) {
      if (entry.type === "directory") for (const sub of nested.get(`${dirs[i]}/${entry.name}`) ?? []) take(sub.name, sub.path);
      else if (entry.type === "file") take(entry.name, entry.path);
    }
  });
  return out;
}

// Before the state file lands, the link may already be in one of the last conversations.
async function linkFromSessions(id: string, profile: string): Promise<string | null> {
  const q = `?profile=${encodeURIComponent(profile)}`;
  try {
    const { data: sessions } = await agent37.listSessions(id, q);
    const details = await Promise.all((sessions ?? []).slice(0, 3).map((s) => agent37.getSession(id, s.id, q).catch(() => null)));
    for (const detail of details) {
      const history = detail?.history ?? [];
      for (let i = history.length - 1; i >= 0; i--) {
        const match = (history[i].content || "").match(/https:\/\/(?:mstudio-frames\.onrender\.com|yelema-dashboards\.onrender\.com)\/share\/frame\/[a-zA-Z0-9_\-]+/i);
        const link = trusted(match?.[0]);
        if (link) return link;
      }
    }
  } catch {
    // No fallback: the dashboard shows its model.
  }
  return null;
}

// A path the state file names, kept only inside the drive and of the expected kind.
function drivePath(value: unknown, ext: string): string | null {
  if (typeof value !== "string") return null;
  const p = value.trim().replace(/^~\//, "");
  return p.toLowerCase().endsWith(ext) && p.startsWith("Livrables/") && !p.split("/").includes("..") ? p : null;
}

async function instanceView(id: string, profile: string): Promise<InstanceView> {
  const isDjeneba = profile.toLowerCase().includes("djeneba");
  // Its own drive folder (« Livrables/Djénéba »), where the pack builds its page in `tableau-de-bord/`.
  const folders = await expertDriveFolders(profile);
  const defaults = folders.flatMap((f) => [`Livrables/${f}/tableau-de-bord`, `Livrables/${f}/Tableau-de-bord`, `Livrables/${f}/Tableaux de bord`]);
  const [state, team, defaultFiles] = await Promise.all([
    fetchCachedDashboardState(id, profile, folders),
    isDjeneba
      ? Promise.all(
          [...folders.map((f) => `Livrables/${f}/_memoire/state/tableaux-de-l-equipe.json`), `memory/state/tableaux-de-l-equipe.json`].map((p) => readJsonFile(id, p))
        ).then((all) => all.map((t) => trusted(t?.lien)).find(Boolean) ?? null)
      : Promise.resolve(null),
    deliverableFiles(id, defaults),
  ]);
  const lien = trusted(state?.lien);
  const folder = typeof state?.fichiers === "string" ? state.fichiers.trim().replace(/\/+$/, "") : "";
  const [own, found] = await filesAndLink(
    lien,
    folder && !folder.split("/").includes("..") ? deliverableFiles(id, folders.map((f) => `Livrables/${f}/${folder}`)) : Promise.resolve(null),
    () => linkFromSessions(id, profile),
  );
  return {
    lien: found,
    hebergeur: lien && typeof state?.hebergeur === "string" ? state.hebergeur : "render",
    maj: typeof state?.maj === "string" ? state.maj : null,
    pdfPath: drivePath(state?.pdfPath, ".pdf") ?? own?.pdfPath ?? defaultFiles.pdfPath,
    htmlPath: drivePath(state?.htmlPath, ".html") ?? own?.htmlPath ?? defaultFiles.htmlPath,
    pptxPath: own?.pptxPath ?? defaultFiles.pptxPath,
    teamViewLien: team,
  };
}

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id, profile } = await params;
    if (!profile || !/^[a-z0-9_-]+$/i.test(profile)) {
      return json({ available: false, message: "Profil d'expert invalide." }, 400);
    }
    await requireAgentAccess(id);

    const meta = getDashboardMeta(profile);
    if (!meta) {
      return json({
        available: false,
        message: "Cet agent n'a pas de tableau de bord metier associe.",
      });
    }

    // Who may read it is the back office's; a share it cannot read is shown as not shared.
    const session = authViaBackoffice() ? await readSession() : null;
    const sharing = session !== null;
    // `?fresh=1`: asked after an instance event (a file written, a turn ended), the kept reading is stale.
    const key = `${id}:${profile.toLowerCase()}`;
    if (new URL(request.url).searchParams.get("fresh") === "1") views.drop(key);
    const [view, share] = await Promise.all([
      views.get(key, () => instanceView(id, profile)),
      session ? backoffice.dashboardShare(session.accessToken, profile).catch(() => null) : Promise.resolve(null),
    ]);

    return json({
      available: true,
      modelFile: meta.modelFile,
      title: meta.title,
      role: meta.role,
      reader: meta.reader,
      kpis: meta.kpis,
      lien: view.lien,
      hebergeur: view.hebergeur,
      maj: view.maj,
      pdfPath: view.pdfPath,
      pptxPath: view.pptxPath,
      htmlPath: view.htmlPath,
      previewUrl: view.lien || `/modeles/${meta.modelFile}`,
      isDjeneba: profile.toLowerCase().includes("djeneba"),
      teamViewLien: view.teamViewLien,
      sharing,
      ...(await shareAnswer(share)),
    });
  } catch (e) {
    return handleError(e);
  }
}

// `{ mode, people?, regenerate? }`: opens or sets the share; `DELETE` stops it. The back office checks the
// expert is the caller's, keeps the rule and logs the change; nothing is written on the instance.
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id, profile } = await params;
    if (!/^[a-z0-9_-]{1,64}$/i.test(profile) || !getDashboardMeta(profile)) return json({ error: "Profil d'expert invalide." }, 400);
    await requireAgentAccess(id);
    const body = await readJson<{ mode?: unknown; people?: unknown; regenerate?: unknown }>(request);
    const mode = MODES.find((m) => m === body.mode);
    if (!mode) return json({ error: "Mode de partage inconnu." }, 400);
    const people = Array.isArray(body.people) ? body.people.filter((e): e is string => typeof e === "string").slice(0, 50) : [];
    const view = await backoffice.saveDashboardShare(await shareToken(), profile, { mode, people, regenerate: body.regenerate === true });
    return json({ ok: true, ...(await shareAnswer(view)) });
  } catch (e) {
    return shareError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id, profile } = await params;
    if (!/^[a-z0-9_-]{1,64}$/i.test(profile) || !getDashboardMeta(profile)) return json({ error: "Profil d'expert invalide." }, 400);
    await requireAgentAccess(id);
    const view = await backoffice.stopDashboardShare(await shareToken(), profile);
    return json({ ok: true, ...(await shareAnswer(view)) });
  } catch (e) {
    return shareError(e);
  }
}

/** A back-office refusal keeps its status and its sentence (written for the member); the rest as usual. */
function shareError(e: unknown) {
  if (e instanceof BackofficeError && e.status < 500) return json({ error: e.message }, e.status);
  return handleError(e);
}
