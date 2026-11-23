"use client";

import { useRef, useState } from "react";
import { ImagePlus, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, readApiError, errorText } from "@/lib/api";
import { companyLogos, keepsSeveralLogos, LOGO_ACCEPT, type CompanyLogo, type CompanyProfile } from "@/lib/company";
import { tooLarge, TOO_LARGE } from "@/lib/upload-limit";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// The company's logo images, as tiles: the main one first (the one in the bar and on the sign-in
// page), then the other versions (light, dark, square, long…), and a tile to add more, by picking
// or dropping several files. While the back office keeps a single logo, the same tiles show that
// one, and adding replaces it.

function check(file: File): string | null {
  if (!LOGO_ACCEPT.split(",").includes(file.type)) return `${file.name} : choisissez une image PNG, JPEG ou WebP.`;
  if (tooLarge(file)) return `${file.name} : ${TOO_LARGE}`;
  return null;
}

export function CompanyLogos({ profile, onProfile }: { profile: CompanyProfile; onProfile: (p: CompanyProfile) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);
  const [removing, setRemoving] = useState<CompanyLogo | null>(null);
  const several = keepsSeveralLogos(profile);
  const logos = companyLogos(profile);

  // The menu follows the profile at once (CompanyProfileView hands its logo to the workspace).
  const changed = (p: CompanyProfile) => onProfile(p);

  async function send(list: File[]) {
    const files = several ? list : list.slice(0, 1);
    const valid = files.filter((f) => {
      const wrong = check(f);
      if (wrong) toast.error(wrong);
      return !wrong;
    });
    if (!valid.length) return;
    setSending({ done: 0, total: valid.length });
    let added = 0;
    for (const file of valid) {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(several ? "/api/workspace/logos" : "/api/workspace/logo", { method: "POST", body: form });
      if (res.ok) {
        added += 1;
        changed((await res.json()) as CompanyProfile);
      } else {
        toast.error(`${file.name} : ${await readApiError(res, "L’image n’a pas pu être enregistrée")}`);
      }
      setSending({ done: added, total: valid.length });
    }
    setSending(null);
    if (added) toast.success(several ? (added > 1 ? `${added} images ajoutées.` : "Image ajoutée.") : "Logo enregistré.");
  }

  async function makeMain(logo: CompanyLogo) {
    try {
      changed(await apiFetch<CompanyProfile>(`/api/workspace/logos/${logo.id}`, { method: "PATCH" }));
      toast.success("Logo principal changé.");
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  const busy = sending !== null;
  const addLabel = busy
    ? sending.total > 1
      ? `Envoi ${sending.done + 1} sur ${sending.total}…`
      : "Envoi en cours…"
    : several
      ? "Ajouter des images"
      : logos.length
        ? "Changer de logo"
        : "Choisir un logo";

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {logos.map((logo) => (
          <figure key={logo.id} className={cn("relative overflow-hidden rounded-2xl border bg-surface", logo.primary ? "border-brand/50 ring-2 ring-brand/15" : "border-line")}>
            <div className="flex aspect-[4/3] items-center justify-center bg-soft p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo.url} alt={logo.primary ? "Logo principal" : (logo.name ?? "Logo")} className="max-h-full max-w-full object-contain" />
            </div>
            <figcaption className="flex min-h-11 items-center gap-1.5 border-t border-line py-1 pl-3 pr-1">
              {logo.primary ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-[11.5px] font-semibold text-brand-ink">
                  <Star className="size-3 fill-current" aria-hidden />
                  Principal
                </span>
              ) : (
                <span className="min-w-0 grow truncate text-[12.5px] text-ink-2">{logo.name ?? "Logo"}</span>
              )}
              {logo.primary && <span className="grow" />}
              <DropdownMenu>
                <DropdownMenuTrigger aria-label="Actions sur cette image" className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-soft hover:text-ink">
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {several && !logo.primary && (
                    <DropdownMenuItem onSelect={() => void makeMain(logo)}>
                      <Star className="size-4" /> Choisir comme logo principal
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setRemoving(logo)} className="text-ko focus:text-ko">
                    <Trash2 className="size-4" /> Retirer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </figcaption>
          </figure>
        ))}

        <button
          type="button"
          disabled={busy}
          onClick={() => picker.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!busy) void send([...e.dataTransfer.files]);
          }}
          className={cn(
            "flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-3 text-center text-sm font-semibold text-brand-ink transition-colors",
            over ? "border-brand bg-tint" : "border-line hover:border-brand/40 hover:bg-soft",
            busy && "cursor-wait opacity-70"
          )}
        >
          <ImagePlus className="size-5" aria-hidden />
          {addLabel}
          {!busy && <span className="text-xs font-normal text-ink-3">ou déposez-les ici</span>}
        </button>
      </div>

      <input
        ref={picker}
        type="file"
        accept={LOGO_ACCEPT}
        multiple={several}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void send(files);
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.primary ? "Retirer le logo principal ?" : "Retirer cette image ?"}
        description={
          removing?.primary
            ? several && logos.length > 1
              ? "Une autre image deviendra le logo principal."
              : "L’entreprise n’aura plus de logo."
            : undefined
        }
        confirmText="Retirer"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            changed(await apiFetch<CompanyProfile>(several ? `/api/workspace/logos/${removing.id}` : "/api/workspace/logo", { method: "DELETE" }));
            toast.success("Image retirée.");
          } catch (e) {
            toast.error(errorText(e));
          }
        }}
      />
    </div>
  );
}
