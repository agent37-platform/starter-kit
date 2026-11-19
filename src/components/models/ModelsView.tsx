"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { llmPending, readOverview, type LlmMember, type LlmOverview, type LlmWritten } from "@/lib/llm";
import { scopeParam, type InstanceScope, type LlmSetup } from "@/lib/llm-accounts";
import type { ClaudeAuthView } from "@/lib/claude-code-auth";
import { AccountsBoard, describe } from "./AccountsBoard";
import { AnswerCheck } from "./AnswerCheck";
import { ClaudeCodeModel } from "./ClaudeCodeModel";
import { ExpertModels } from "./ExpertModels";
import { MemberSources } from "./MemberSources";
import { ModelsBoundary } from "./ModelsBoundary";
import { useModelGroups } from "./useModelGroups";
import { YelemaEngine } from "./YelemaEngine";
import { usePoll } from "@/components/usePoll";
import { Picker } from "@/components/ui/picker";

const REFUSED = "Le fournisseur n’accepte plus cette clé. Vos Experts ne répondent plus tant qu’elle n’est pas remplacée ou retirée.";
// Une pose prend d'ordinaire moins d'une minute par instance ; au-delà, on cesse de relire seul.
const POLL_MS = 4_000;
const POLL_TRIES = 45;
const EMPTY: LlmSetup = { groups: [], state: "applied" };

// Intégrations · Modèles : les comptes de l'instance, le modèle des experts, le moteur Yelema. Un compte
// ne sert qu'une instance : rien n'est partagé avec l'entreprise. L'écran affiche ce que le back-office
// sert et lui demande d'écrire ; il ne garde aucun secret.
export function ModelsView() {
  const [data, setData] = useState<LlmOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<InstanceScope>({ kind: "own" });
  const [round, setRound] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(readOverview(await apiFetch<unknown>("/api/llm")));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Tant qu'une pose est en cours, l'état est relu : l'écran passe seul à « En service » ou à l'échec.
  // Avec le flux, `job.done` (llm) dit quand relire ; sans lui, un filet à 15 s au moins.
  usePoll(load, { everyMs: POLL_MS, deadlineMs: POLL_MS * POLL_TRIES, immediate: false, round, enabled: Boolean(data && llmPending(data)), live: true, wake: { types: ["job.done"], kind: "llm" } });

  const admin = data?.members !== undefined;
  const others = useMemo(() => othersOf(data), [data]);
  // Un administrateur sans instance à lui regarde d'emblée celle d'un autre membre.
  useEffect(() => {
    if (data && admin && !data.mine && others[0]) setScope((s) => (s.kind === "own" ? { kind: "member", id: others[0]!.id } : s));
  }, [data, admin, others]);

  const member = scope.kind === "member" ? data?.members?.find((m) => m.id === scope.id) : undefined;
  // Une instance sous Claude Code ne prend que l'abonnement Claude ou une clé Anthropic : son propre bloc.
  const claudeMember = scope.kind === "member" ? scope.id : null;
  const [claude, setClaude] = useState<ClaudeAuthView | null>(null);
  const loadClaude = useCallback(async () => {
    try {
      setClaude(await apiFetch<ClaudeAuthView>(`/api/claude-code/auth${claudeMember ? `?member=${encodeURIComponent(claudeMember)}` : ""}`));
    } catch {
      setClaude({ unsupported: true });
    }
  }, [claudeMember]);
  useEffect(() => {
    setClaude(null);
    void loadClaude();
  }, [loadClaude]);
  const setup = (scope.kind === "member" ? member?.setup : data?.setup) ?? EMPTY;
  const version = setup.groups.map((g) => `${g.provider}:${g.accounts.length}`).join(",");
  const models = useModelGroups(data ? scopeParam(scope) : null, undefined, version);

  const changed = useCallback(
    async (out?: LlmWritten | null) => {
      setRound((r) => r + 1);
      await load();
      if (out) toast.success("Modèle enregistré", { description: out.state === "pending" ? "Mise en place en cours, quelques instants." : undefined });
    },
    [load],
  );

  if (error && !data) return <p className="max-w-xl rounded-xl bg-ko-pale px-4 py-3 text-sm text-ko">{error}</p>;
  if (!data || !claude) return <div className="h-40 animate-pulse rounded-[22px] border border-line bg-soft" />;

  const who = member?.name ?? member?.email ?? "ce membre";
  const title = scope.kind === "member" ? `Comptes d’IA de ${who}` : "Vos comptes d’IA";
  const scopeLabel = scope.kind === "member" ? `l’espace de ${who}` : "votre espace";
  const refused = (scope.kind === "member" ? member?.state : data.mine?.state) === "refused";
  const catalogues = { catalogue: data.catalogue ?? [], logins: data.logins ?? [] };

  const picker = admin && others.length > 0 ? <InstancePicker mine={!!data.mine} others={others} value={scope} onChange={setScope} /> : undefined;
  if (!("unsupported" in claude)) {
    return (
      <div className="space-y-6">
        <p className="text-[15px] text-ink-2">Vos Experts utilisent Claude. Connectez votre abonnement Claude, ou ajoutez des clés.</p>
        <ClaudeCodeModel status={claude} member={claudeMember} picker={picker} onChanged={loadClaude} />
        {admin && data.members && <MemberSources members={data.members} onPick={(id) => setScope(data.members?.find((m) => m.id === id)?.self ? { kind: "own" } : { kind: "member", id })} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-[15px] text-ink-2">Branchez vos propres comptes d’IA et choisissez le modèle de vos Experts.</p>

      {refused && (
        <div role="alert" className="flex gap-2.5 rounded-[22px] border border-ko/30 bg-ko-pale p-4 text-sm text-ko">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{REFUSED}</p>
        </div>
      )}

      <ModelsBoundary key={`accounts-${scopeParam(scope) ?? "own"}`}>
        <AccountsBoard
          setup={setup}
          scope={scope}
          title={title}
          picker={picker}
          scopeLabel={scopeLabel}
          {...catalogues}
          customEndpoints={data.customEndpoints === true}
          models={models}
          onChanged={() => changed()}
        />
      </ModelsBoundary>

      <ModelsBoundary key={`experts-${scopeParam(scope) ?? "own"}`}>
        <ExpertModels scope={scope} setup={setup} yelema={data.yelema} models={models} groupName={(g) => describe(g, catalogues).name} onChanged={changed} />
      </ModelsBoundary>

      {scope.kind === "own" && data.mine && (
        <ModelsBoundary key="answer-check">
          <AnswerCheck models={models} scope={scope} scopeLabel={scopeLabel} {...catalogues} onAccountAdded={() => changed()} />
        </ModelsBoundary>
      )}

      {data.yelema && <YelemaEngine yelema={data.yelema} />}

      {admin && data.members && <MemberSources members={data.members} onPick={(id) => setScope(data.members?.find((m) => m.id === id)?.self ? { kind: "own" } : { kind: "member", id })} />}
    </div>
  );
}

/** Les autres membres, sans l'appelant : sa propre instance est « Mon instance ». */
const othersOf = (data: LlmOverview | null): LlmMember[] => (data?.members ?? []).filter((m) => !m.self);

// Le choix de l'instance regardée, compact, dans l'en-tête du bloc des comptes (admin seulement).
function InstancePicker({ mine, others, value, onChange }: { mine: boolean; others: LlmMember[]; value: InstanceScope; onChange: (scope: InstanceScope) => void }) {
  const options = [...(mine ? [{ value: "own", label: "Mes Experts" }] : []), ...others.map((m) => ({ value: m.id, label: m.name ?? m.email }))];
  return (
    <Picker
      label="Réglage pour"
      placeholder="Mes Experts"
      value={value.kind === "member" ? value.id : "own"}
      onChange={(v) => onChange(v === "own" ? { kind: "own" } : { kind: "member", id: v })}
      groups={[{ options }]}
      className="max-w-[14rem] sm:h-8"
    />
  );
}
