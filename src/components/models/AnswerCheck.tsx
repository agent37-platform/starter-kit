"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { checkDefault, readAnswerCheck, type AnswerCheckView } from "@/lib/answer-check";
import type { LlmLogin, LlmProvider, LlmWritten } from "@/lib/llm";
import type { InstanceScope, ModelChoice } from "@/lib/llm-accounts";
import type { ModelGroup } from "@/lib/model-options";
import { AddAccountDialog } from "./AddAccountDialog";
import { ModelPicker } from "./ModelPicker";

const ADDED_NOTICE = "Ce compte passe après vos comptes actuels : vos Experts gardent leur modèle. Il vérifie les réponses et ne sert d’appoint que si tous vos autres comptes sont épuisés.";
const NO_OWN = "Pour vérifier avec un autre fournisseur, branchez d’abord vos propres comptes d’IA : votre espace utilise aujourd’hui le modèle fourni par Yelema.";

type Adding = { value: string; label: string; keys: string[] };

// Bloc « Vérification des réponses » : avant de partir, une réponse qui affirme un fait est relue par un
// modèle qui en cherche la preuve. Par défaut un autre fournisseur de l'espace, sinon le modèle de l'Expert.
// Un autre fournisseur s'ajoute ici même : sa clé par le parcours des comptes, puis il vérifie aussitôt.
export function AnswerCheck({ models, scope, scopeLabel, catalogue, logins, onAccountAdded }: {
  models: ModelGroup[] | null;
  scope: InstanceScope;
  scopeLabel: string;
  catalogue: LlmProvider[];
  logins: LlmLogin[];
  onAccountAdded: () => Promise<void>;
}) {
  const [view, setView] = useState<AnswerCheckView | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
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

  async function pick(choice: { provider: string; model: string } | null) {
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

  // Compte ajouté : il vérifie tout de suite, avec le modèle par défaut de son fournisseur (affinable ensuite).
  async function added(provider: string) {
    await onAccountAdded();
    await pick({ provider, model: "" });
  }

  if (failed) return null;
  if (!view) return <div className="h-24 animate-pulse rounded-[22px] border border-line bg-soft" />;

  const allowed = new Set(view.providers.map((p) => p.value));
  const groups = (models ?? []).filter((g) => allowed.has(g.provider));
  const value: ModelChoice | null = view.source === "instance" && view.own.provider && view.own.model ? { provider: view.own.provider, model: view.own.model } : null;
  const fallback = checkDefault(view);

  return (
    <section className="space-y-3 rounded-[22px] border border-line bg-surface p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-3">
        <ShieldCheck className="h-3.5 w-3.5 text-brand" /> Vérification des réponses
      </h2>
      <p className="text-xs text-ink-3">Avant d’envoyer une réponse qui affirme un fait, un modèle vérifie qu’elle s’appuie sur ce que l’Expert a réellement consulté.</p>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <span className="truncate text-sm font-medium text-ink">Modèle de vérification</span>
        <ModelPicker label="Modèle de vérification des réponses" groups={groups} value={value} nullLabel={fallback.label} disabled={busy || groups.length === 0} onChange={(c) => void pick(c)} />
      </div>
      {view.source === "global" && <p className="text-[11px] max-sm:text-[12px] text-ink-3">{fallback.line}</p>}
      {view.source === "instance" && view.own.provider && !view.own.model && (
        <p className="text-[11px] max-sm:text-[12px] text-ink-3">Vérifié par {view.own.providerLabel ?? view.own.provider}, avec son modèle par défaut.</p>
      )}
      {view.others.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-ink-3">Vérifier avec un autre fournisseur :</p>
          <div className="flex flex-wrap gap-1.5">
            {view.others.map((o) => (
              <button key={o.value} type="button" disabled={busy} onClick={() => setAdding(o)} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand/40 hover:bg-soft disabled:opacity-50">
                <Plus className="h-3 w-3" /> {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!view.canAdd && <p className="text-[11px] max-sm:text-[12px] text-ink-3">{NO_OWN}</p>}
      {view.lost && <p className="text-[11px] max-sm:text-[12px] text-ko">Le compte choisi n’est plus branché : le réglage par défaut vérifie en attendant.</p>}
      {view.source === "instance" && (
        <button type="button" disabled={busy} onClick={() => void pick(null)} className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">
          Revenir au réglage par défaut
        </button>
      )}
      <AddAccountDialog
        open={adding !== null}
        scope={scope}
        scopeLabel={scopeLabel}
        catalogue={catalogue}
        logins={logins}
        customEndpoints={false}
        only={adding?.keys}
        notice={ADDED_NOTICE}
        onAdded={() => (adding ? added(adding.value) : Promise.resolve())}
        onClose={() => setAdding(null)}
      />
    </section>
  );
}
