"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Info, Loader2, Mic, Send, SlidersHorizontal, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AttachButton, AttachmentTray } from "./Attachments";
import { EffortMenu } from "./EffortMenu";
import { ModelMenu } from "./ModelMenu";
import type { ChatAttachments } from "./useChatAttachments";
import { useChatModels } from "./useChatModels";
import { useChatContext } from "./ChatProvider";
import { findModel, prettyModelLabel, type ChatSettings } from "./types";
import type { SendSettings } from "./useChat";
import { useDictation } from "./useDictation";
import { rememberSettings, rememberedSettings } from "./rememberedSettings";
import { useCallState } from "@/components/voice/CallProvider";
import { useVoices } from "@/components/voice/useVoices";
import { useExpertsContext } from "@/components/experts/ExpertsProvider";
import { commandsOf, filterCommands, missingFor, type ExpertCommand } from "@/lib/expert-commands";
import { CommandMenu } from "./CommandMenu";
import { UpdateSpinner, useDeployPhase } from "@/components/app/DeployStatus";

interface Props {
  agentId: string;
  isStreaming: boolean;
  // Attachment state is owned by ChatView (so the whole pane is a drop zone) and passed in.
  att: ChatAttachments;
  onSend: (text: string, settings: SendSettings) => void;
  onStop: () => void;
  // Prominent welcome-state composer (vs the compact docked composer).
  large?: boolean;
  focusToken?: number;
  /** Text put in the composer (an approval « Modifier »); a new token puts it again. */
  draft?: { text: string; token: number } | null;
}

export function ChatComposer({ agentId, isStreaming, att, onSend, onStop, large = false, focusToken = 0, draft = null }: Props) {
  const [text, setText] = useState("");
  // model + provider are always chosen together (one selection); effort is independent. Group
  // them as the composer's outgoing ChatSettings so send is just `{ ...settings, files }`.
  const [settings, setSettingsState] = useState<ChatSettings>({ model: null, provider: null, reasoningEffort: null });
  // The last choice, from any screen, once this Expert's models are known: a model it does not offer
  // falls back to its default, the effort always carries over.
  const setSettings = (next: (s: ChatSettings) => ChatSettings) =>
    setSettingsState((s) => {
      const v = next(s);
      rememberSettings(v);
      return v;
    });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Each expert's profile has its own model configuration.
  const { profile } = useChatContext();
  const { groups, defaultModel, loading } = useChatModels(agentId, profile);
  useEffect(() => {
    if (loading) return;
    const r = rememberedSettings();
    const known = findModel(groups, r.model, r.provider);
    setSettingsState({ model: known ? r.model : null, provider: known ? r.provider : null, reasoningEffort: r.reasoningEffort });
  }, [loading, groups]);

  useEffect(() => {
    if (focusToken === 0) return;
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusToken]);

  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    const frame = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(draft.text.length, draft.text.length);
      grow(el);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.token]);

  // The model switcher is a persistent control, shown once the instance reports at least one model
  // (the older metered gateway exposes a single "default"; current builds expose the full catalog).
  // It stays hidden until the list resolves and hides if the call returns nothing (e.g. fetch
  // failed) — the agent default still runs, and there's no appear-then-vanish flicker. Every group
  // carries at least one model (useChatModels only creates a group when it has one), so a non-empty
  // `groups` is exactly "has models".
  const defaultLabel = useMemo(() => {
    const def = findModel(groups, defaultModel);
    return def ? prettyModelLabel(def.label) : loading ? "Chargement…" : "Par défaut";
  }, [groups, defaultModel, loading]);

  const grow = (el: HTMLTextAreaElement) => {
    const minHeight = large ? 76 : 44;
    const maxHeight = 180;
    el.style.height = "auto";
    el.style.height = `${Math.max(minHeight, Math.min(el.scrollHeight, maxHeight))}px`;
  };

  // Dictation goes through the speech service: offered only where voice is on (voices are offered).
  const canDictate = useVoices().length > 0;
  const { experts } = useExpertsContext();
  const expert = experts.find((e) => e.agentId === agentId && e.profileId === profile);
  const expertKey = expert?.catalogueKey ?? null;
  // While an update runs, said where the member writes, so a slow or missing answer is not taken for
  // the Expert's fault (Leslie, 06/11: « il faut que ça se voie même dans le chat »).
  const updating = useDeployPhase() === "maintenance";
  // « / » opens the Expert's commands; a command picked shows as a chip and says what it still needs.
  const commands = useMemo(() => commandsOf(expertKey, expert?.driveFolder ?? expert?.displayName), [expertKey, expert?.driveFolder, expert?.displayName]);
  const [chosen, setChosen] = useState<ExpertCommand | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const menuOpen = !chosen && !dismissed && commands.length > 0 && /^\/\S*$/.test(text);
  const shown = useMemo(() => (menuOpen ? filterCommands(commands, text.slice(1)) : []), [menuOpen, commands, text]);
  useEffect(() => setActive(0), [text]);
  const pick = (c: ExpertCommand) => {
    setChosen(c);
    setText("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const dictation = useDictation({
    expert: expertKey,
    onText: (said) => {
      setText((prev) => (prev.trim() ? `${prev.trim()} ${said}` : said));
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        grow(textareaRef.current);
        textareaRef.current.focus();
      });
    },
    onError: (message) => toast.error(message),
  });
  const dictating = dictation.state !== "idle";
  // A call already holds the microphone: no second one, and a dictation under way gives way.
  const { active: onCall } = useCallState();
  useEffect(() => {
    if (onCall && dictation.state !== "idle") dictation.cancel();
  }, [onCall, dictation]);

  // Sending stays open while the expert answers: the message joins the running turn, or waits behind it.
  const missing = chosen ? missingFor(chosen, text, att.hasFiles) : null;
  const canSend = (chosen ? !missing : text.trim().length > 0 || att.hasFiles) && !att.blocksSend && !dictating;

  const submit = () => {
    const typed = text.trim();
    if (chosen ? missing !== null : !typed && !att.hasFiles) return;
    if (att.blocksSend) return;
    const trimmed = chosen ? `/${chosen.cmd}${typed ? ` ${typed}` : ""}` : typed;
    const attachments = att.takeAttachments();
    onSend(trimmed, { ...settings, files: attachments.map((a) => a.path), attachments });
    setText("");
    setChosen(null);
    setDismissed(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (shown.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        if (shown[active]) {
          e.preventDefault();
          pick(shown[active]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    // Backspace in an empty field takes the command back off.
    if (e.key === "Backspace" && chosen && !text) {
      e.preventDefault();
      setChosen(null);
      setText("/");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const modelMenu = groups.length > 0 && (
    <ModelMenu
      groups={groups}
      model={settings.model}
      defaultModel={defaultModel}
      defaultLabel={defaultLabel}
      onChange={(model, provider) => setSettings((s) => ({ ...s, model, provider }))}
    />
  );
  const effortMenu = (
    <EffortMenu value={settings.reasoningEffort} onChange={(reasoningEffort) => setSettings((s) => ({ ...s, reasoningEffort }))} />
  );

  return (
    <div
      className={cn(
        "@container mx-auto w-full rounded-[22px] border border-line bg-surface shadow-[0_8px_30px_rgb(48_22_103_/_0.06)] transition-[border-color,box-shadow] focus-within:border-brand/30",
        // Docked, the bar takes the whole width (Leslie, 16/11); centred, it stays a reading width.
        large && "max-w-2xl",
        "relative"
      )}
    >
      {updating && (
        <p role="status" data-update-note="" className="flex items-center gap-2 rounded-t-[21px] border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-[13px] font-medium leading-snug text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <UpdateSpinner />
          <span>
            Mise à jour en cours : {expert ? expert.displayName : "vos Experts"} {expert ? "peut" : "peuvent"} répondre plus lentement ou reprendre après la mise à jour. Vos messages sont gardés.
          </span>
        </p>
      )}
      {menuOpen && (
        <CommandMenu
          name={expert?.displayName ?? "l’Expert"}
          items={shown}
          total={commands.length}
          active={active}
          onHover={setActive}
          onPick={pick}
        />
      )}
      {chosen && (
        <div className="px-4 pt-3">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-tint px-2 py-0.5 text-sm font-semibold text-brand-ink">
            <span className="truncate">{chosen.label}</span>
            <button
              type="button"
              onClick={() => {
                setChosen(null);
                textareaRef.current?.focus();
              }}
              aria-label="Retirer la commande"
              className="inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-brand/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          grow(e.target);
        }}
        onKeyDown={onKeyDown}
        onPaste={att.handlePaste}
        rows={1}
        placeholder={
          chosen
            ? chosen.example
              ? `Ex. : ${chosen.example}`
              : "Ajoutez une précision, ou envoyez"
            : commands.length > 0
              ? "Écrivez, ou tapez / pour les commandes"
              : "Écrivez votre message…"
        }
        className={cn(
          "w-full resize-none bg-transparent px-5 pb-2 text-ink placeholder:text-ink-3 focus:outline-none",
          chosen ? "pt-2" : "pt-4",
          large ? "min-h-[76px] max-h-[180px] text-[15px] leading-6" : "min-h-[44px] max-h-[180px] text-[15px] leading-relaxed"
        )}
      />
      <AttachmentTray files={att.files} onRemove={att.removeFile} onRetry={att.retryFile} />
      {missing && (
        <p className="mx-3 mb-2 flex items-start gap-2 rounded-xl bg-coral-pale px-3 py-2 text-[13px] text-coral-ink">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Il manque {missing}.{chosen?.fileOk ? " Écrivez-le, ou joignez le document." : " Écrivez-le avant d’envoyer."}
          </span>
        </p>
      )}
      {dictating ? (
        <DictationBar dictation={dictation} />
      ) : (
      <div className="flex items-center gap-2 px-3 pb-3">
        <div className="flex min-w-0 shrink items-center gap-1.5 max-sm:hidden">
          {modelMenu}
          {effortMenu}
        </div>
        <PhoneSettings
          model={modelMenu}
          effort={<EffortMenu value={settings.reasoningEffort} emptyLabel="Par défaut" onChange={(reasoningEffort) => setSettings((s) => ({ ...s, reasoningEffort }))} />}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <AttachButton onFiles={att.addFiles} />
          {canDictate && (
            <button
              type="button"
              onClick={() => void dictation.start()}
              disabled={onCall}
              aria-label={onCall ? "Pendant l’appel, écrivez au clavier" : "Dicter un message"}
              title={onCall ? "Pendant l’appel, écrivez au clavier" : "Dicter un message"}
              // When the composer is narrow (phone, reduced window, side columns open), ONE round button:
              // the microphone while the message is empty, then Envoyer. Container query, not the viewport.
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-xl text-ink-2 transition-colors hover:bg-soft hover:text-ink disabled:opacity-40",
                "@max-xl:size-10 @max-xl:rounded-full @max-xl:bg-brand @max-xl:text-on-brand @max-xl:hover:bg-brand @max-xl:hover:text-on-brand",
                canSend && "@max-xl:hidden"
              )}
            >
              <Mic className="h-[18px] w-[18px]" />
            </button>
          )}
          {isStreaming && (
            <button
              type="button"
              onClick={onStop}
              aria-label="Arrêter"
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-bg hover:opacity-90 @max-xl:w-10 @max-xl:justify-center @max-xl:rounded-full @max-xl:px-0"
            >
              <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} /> <span className="@max-xl:sr-only">Arrêter</span>
            </button>
          )}
          {(!isStreaming || canSend) && (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Envoyer"
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:opacity-40",
                "@max-xl:w-10 @max-xl:justify-center @max-xl:rounded-full @max-xl:px-0",
                !canSend && canDictate && "@max-xl:hidden"
              )}
            >
              {att.uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="@max-xl:sr-only">Envoyer</span>
            </button>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** While dictating: duration and level, then cancel or keep (which transcribes into the message). */
export function DictationBar({ dictation }: { dictation: ReturnType<typeof useDictation> }) {
  const transcribing = dictation.state === "transcribing";
  return (
    <div className="flex items-center gap-3 px-3 pb-3">
      <span className={cn("size-2.5 shrink-0 rounded-full", transcribing ? "bg-ink-3" : "animate-pulse bg-ko")} />
      <span className="w-10 shrink-0 text-sm tabular-nums text-ink-2">{clock(dictation.seconds)}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-soft">
        <div className="h-full rounded-full bg-brand transition-[width] duration-100" style={{ width: `${Math.round(dictation.level * 100)}%` }} />
      </div>
      {transcribing ? (
        <span className="inline-flex shrink-0 items-center gap-2 text-sm text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Transcription…
        </span>
      ) : (
        <>
          <button type="button" onClick={dictation.cancel} aria-label="Annuler la dictée" className="inline-flex size-9 items-center justify-center rounded-xl text-ink-2 hover:bg-soft">
            <Trash2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={dictation.finish} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand hover:opacity-90">
            <Check className="h-4 w-4" /> Terminer
          </button>
        </>
      )}
    </div>
  );
}

// On a phone, one icon for the model and the effort (Leslie, 04/11, point 7): the field keeps its room.
function PhoneSettings({ model, effort }: { model: ReactNode; effort: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Modèle et effort"
        title="Modèle et effort"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary/70 text-ink-2 hover:text-ink sm:hidden"
      >
        <SlidersHorizontal className="size-[18px]" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[22px]"
        >
          <DialogTitle className="text-[17px] font-bold text-ink">Modèle et effort</DialogTitle>
          <div className="space-y-3 pb-2">
            {model && (
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-[14px] font-semibold text-ink-2">Modèle</span>
                <span className="min-w-0">{model}</span>
              </div>
            )}
            <div className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-[14px] font-semibold text-ink-2">Effort</span>
              {effort}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
