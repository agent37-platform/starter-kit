"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { readAnswerCheck, type AnswerCheckView } from "@/lib/answer-check";
import type { LlmWritten } from "@/lib/llm";
import type { ModelChoice } from "@/lib/llm-accounts";
import type { ModelGroup } from "@/lib/model-options";
import { ModelPicker } from "./ModelPicker";

const SAME = "Comme le modèle de l’Expert";

// Bloc « Vérification des réponses » : avant de partir, une réponse qui affirme un fait est relue par un
// modèle qui en cherche la preuve. Par défaut celui de l'Expert ; sinon un modèle d'un compte de l'espace.
export function AnswerCheck({ models }: { models: ModelGroup[] | null }) {
  const [view, setView] = useState<AnswerCheckView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(readAnswerCheck(await apiFetch<unknown>("/api/llm/judge")));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function pick(choice: ModelChoice | null) {
    setBusy(true);
    try {
      const out = await apiFetch<LlmWritten>("/api/llm/judge", choice ? { method: "PUT", body: JSON.stringify({ provider: choice.provider, model: choice.model }) } : { method: "DELETE" });
      toast.success("Vérification enregistrée", { description: out.state === "pending" ? "Mise en place en cours, quelques instants." : undefined });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (failed) return null;
  if (!view) return <div className="h-24 animate-pulse rounded-[22px] border border-line bg-soft" />;

  const allowed = new Set(view.providers.map((p) => p.value));
  const groups = (models ?? []).filter((g) => allowed.has(g.provider));
  const value: ModelChoice | null = view.source === "instance" && view.own.provider && view.own.model ? { provider: view.own.provider, model: view.own.model } : null;

  return (
    <section className="space-y-3 rounded-[22px] border border-line bg-surface p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-3">
        <ShieldCheck className="h-3.5 w-3.5 text-brand" /> Vérification des réponses
      </h2>
      <p className="text-xs text-ink-3">Avant d’envoyer une réponse qui affirme un fait, un modèle vérifie qu’elle s’appuie sur ce que l’Expert a réellement consulté.</p>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <span className="truncate text-sm font-medium text-ink">Modèle de vérification</span>
        <ModelPicker label="Modèle de vérification des réponses" groups={groups} value={value} nullLabel={SAME} disabled={busy || groups.length === 0} onChange={(c) => void pick(c)} />
      </div>
      {view.lost && <p className="text-[11px] max-sm:text-[12px] text-ko">Le compte choisi n’est plus branché : le modèle de l’Expert vérifie en attendant.</p>}
      {view.source === "instance" && (
        <button type="button" disabled={busy} onClick={() => void pick(null)} className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">
          Revenir au réglage par défaut
        </button>
      )}
    </section>
  );
}
