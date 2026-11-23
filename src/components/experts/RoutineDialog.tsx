"use client";

import { useRef, useState } from "react";
import { Check, History, Loader2, Paperclip, Repeat, X } from "lucide-react";
import { toast } from "sonner";
import { TOO_LARGE, tooLarge } from "@/lib/upload-limit";
import { apiFetch, readApiError, errorText } from "@/lib/api";
import { DRIVE_ROOT } from "@/lib/drive-paths";
import {
  RECURRENCES,
  ROUTINE_TIMEZONE,
  cronFor,
  cronParts,
  isOneOff,
  oneOffFor,
  recurrenceOf,
  todayIso,
  type Routine,
} from "@/lib/routines";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Picker } from "@/components/ui/picker";

// What the tab needs to know about the expert: its profile on the instance (where the routines
// live), and what the catalogue says of it.
export interface RoutineExpert {
  profileId: string;
  name: string;
  /** Skill names a routine may call on; empty when the catalogue does not list any. */
  skills: string[];
  /** The expert's folder in the drive, where a routine's attached file is saved. */
  driveFolder: string;
}

const KEEP = "keep"; // an existing schedule the form can't show, kept as it is

interface Draft {
  name: string;
  task: string;
  recurring: boolean;
  date: string;
  time: string;
  recurrence: string; // "dom|dow", or KEEP
  skills: string[];
  attachment: string | null;
}

function draftOf(routine: Routine | null): Draft {
  const blank = { date: todayIso(1), time: "09:00", recurrence: "*|1-5" };
  if (!routine) return { name: "", task: "", recurring: true, skills: [], attachment: null, ...blank };
  const base = { name: routine.name, task: routine.task, skills: routine.skills, attachment: routine.attachment };
  if (isOneOff(routine.schedule)) {
    const d = new Date(routine.schedule);
    const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    return { ...base, ...blank, recurring: false, date: routine.schedule.slice(0, 10), time };
  }
  const parts = cronParts(routine.schedule);
  return parts
    ? { ...base, ...blank, recurring: true, time: parts.time, recurrence: `${parts.dom}|${parts.dow}` }
    : { ...base, ...blank, recurring: true, recurrence: KEEP };
}

export function RoutineDialog({
  open,
  onOpenChange,
  agentId,
  expert,
  routine,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  expert: RoutineExpert;
  routine: Routine | null;
  onSaved: (routine: Routine) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(routine));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // The routine's own schedule, when it is one the presets don't list ("Chaque lundi et jeudi").
  const parts = routine && !isOneOff(routine.schedule) ? cronParts(routine.schedule) : null;
  const recurrences = [
    ...RECURRENCES.map((r) => ({ value: `${r.dom}|${r.dow}`, label: r.label })),
    ...(parts && !RECURRENCES.some((r) => r.dom === parts.dom && r.dow === parts.dow)
      ? [{ value: `${parts.dom}|${parts.dow}`, label: recurrenceOf(parts) }]
      : []),
    ...(draft.recurrence === KEEP && routine ? [{ value: KEEP, label: `Comme aujourd’hui (${routine.schedule})` }] : []),
  ];

  async function attach(file: File) {
    if (tooLarge(file)) {
      toast.error(TOO_LARGE);
      return;
    }
    setUploading(true);
    try {
      const path = `${DRIVE_ROOT}/${expert.driveFolder}/Routines/${file.name}`;
      const res = await fetch(`/api/agents/${agentId}/files/content?path=${encodeURIComponent(path)}&overwrite=true`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error(await readApiError(res, "Le fichier n’a pas pu être envoyé"));
      set({ attachment: path });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.task.trim()) {
      toast.error("Décrivez la tâche à faire.");
      return;
    }
    let schedule: string;
    if (!draft.recurring) schedule = oneOffFor(draft.date, draft.time);
    else if (draft.recurrence === KEEP) schedule = routine!.schedule;
    else {
      const [dom, dow] = draft.recurrence.split("|");
      schedule = cronFor({ dom, dow, time: draft.time });
    }
    setBusy(true);
    try {
      const body = JSON.stringify({ expert: expert.profileId, name: draft.name, task: draft.task, skills: draft.skills, attachment: draft.attachment, schedule });
      const res = routine
        ? await apiFetch<{ routine: Routine }>(`/api/agents/${agentId}/routines/${routine.id}`, { method: "PATCH", body })
        : await apiFetch<{ routine: Routine }>(`/api/agents/${agentId}/routines`, { method: "POST", body });
      onSaved(res.routine);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "text-[13px] font-semibold text-ink-2";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {expert.name}, {routine ? "modifier la routine" : "nouvelle routine"}
          </DialogTitle>
          <DialogDescription>
            {expert.name} la fait à l’heure dite, sans qu’on le demande. Le résultat arrive dans ses conversations et sur ses canaux.
          </DialogDescription>
        </DialogHeader>
        <form id="routine-form" onSubmit={save} className="grid content-start gap-3">
          <Input
            placeholder="Nom de la routine"
            aria-label="Nom de la routine"
            maxLength={80}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          <textarea
            placeholder="Décrivez la tâche à faire"
            aria-label="Description"
            rows={5}
            value={draft.task}
            onChange={(e) => set({ task: e.target.value })}
            className="w-full resize-y rounded-xl border bg-card px-4 py-3 text-[15px] text-ink placeholder:text-ink-3 focus-visible:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/15"
          />

          <div className="flex w-fit rounded-xl bg-soft p-1" role="group" aria-label="Quand">
            {[
              { recurring: false, label: "Plus tard", icon: History },
              { recurring: true, label: "Récurrent", icon: Repeat },
            ].map((m) => (
              <button
                key={m.label}
                type="button"
                aria-pressed={draft.recurring === m.recurring}
                onClick={() => set({ recurring: m.recurring })}
                className={cn(
                  "flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold",
                  draft.recurring === m.recurring ? "bg-card text-ink shadow-sm" : "text-ink-2"
                )}
              >
                <m.icon className="h-4 w-4" /> {m.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {draft.recurring ? (
              <Picker label="Fréquence" placeholder="Fréquence" value={draft.recurrence} onChange={(v) => set({ recurrence: v })} groups={[{ options: recurrences }]} className="sm:h-11 sm:text-[15px]" />
            ) : (
              <Input
                type="date"
                aria-label="Jour"
                min={todayIso()}
                value={draft.date}
                onChange={(e) => set({ date: e.target.value })}
                className="w-auto"
              />
            )}
            {!(draft.recurring && draft.recurrence === KEEP) && (
              <Input
                type="time"
                aria-label="Heure"
                step={300}
                value={draft.time}
                onChange={(e) => set({ time: e.target.value || "09:00" })}
                className="w-auto"
              />
            )}
            <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
              <History className="h-3.5 w-3.5" /> {ROUTINE_TIMEZONE}, GMT
            </span>
          </div>

          {expert.skills.length > 0 && (
            <div>
              <p className={label}>Compétences</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {expert.skills.map((title) => {
                  const s = { title };
                  const on = draft.skills.includes(s.title);
                  return (
                    <button
                      key={s.title}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ skills: on ? draft.skills.filter((x) => x !== s.title) : [...draft.skills, s.title] })}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] font-medium",
                        on ? "border-brand/30 bg-tint text-brand-ink" : "border-border text-ink-2 hover:bg-soft"
                      )}
                    >
                      {on && <Check className="h-3.5 w-3.5" />} {s.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void attach(file);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />} Joindre un fichier
            </Button>
            {draft.attachment && (
              <span className="flex items-center gap-1 rounded-full bg-soft px-3 py-1 text-[13px] text-ink-2">
                {draft.attachment.split("/").pop()}
                <button type="button" aria-label="Retirer le fichier" onClick={() => set({ attachment: null })}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" form="routine-form" disabled={busy || uploading}>
            {busy && <Loader2 className="animate-spin" />}
            {routine ? "Enregistrer" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
