"use client";

import { useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { channelError, isChannelConnected, type ChannelField, type MessagingPlatform } from "@/lib/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAsyncAction } from "@/components/useAsyncAction";

// The form for every channel that is a credential rather than a flow: Slack, Discord, and the two
// dozen others the harness supports. Nothing about it is channel-specific: the fields, their labels,
// which are secret, and where to get them all come from what the harness reported, so this one
// component connects a channel this app has never heard of.
//
// Only the fields the harness marks required are asked for up front; the rest sit behind "Advanced".
// A secret that is already set stays blank and is left alone unless you type a replacement.
export function ChannelCredentialsForm({
  agentId,
  channel,
  onBack,
}: {
  agentId: string;
  channel: MessagingPlatform;
  onBack: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { busy, run } = useAsyncAction();

  const connected = isChannelConnected(channel);
  const primary = channel.env_vars.filter((f) => !f.advanced);
  const advanced = channel.env_vars.filter((f) => f.advanced);

  const save = () =>
    run(async () => {
      await apiFetch(`/api/agents/${agentId}/channels/${channel.id}`, {
        method: "PUT",
        body: JSON.stringify({ env: values, enabled: true }),
      });
      toast.success(`${channel.name} saved. The agent is connecting.`);
      onBack();
    });

  const disconnect = () =>
    run(async () => {
      await apiFetch(`/api/agents/${agentId}/channels/${channel.id}`, { method: "DELETE" });
      toast.success(`${channel.name} disconnected`);
      onBack();
    });

  return (
    <div className="space-y-5">
      <ChannelPanelHeader channel={channel} onBack={onBack} />

      <div className="space-y-4">
        {primary.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={(value) => setValues((v) => ({ ...v, [field.key]: value }))}
          />
        ))}

        {advanced.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? "Hide" : "Show"} advanced settings ({advanced.length})
            </button>
            {showAdvanced &&
              advanced.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  onChange={(value) => setValues((v) => ({ ...v, [field.key]: value }))}
                />
              ))}
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={busy}>
          {connected ? "Save" : `Connect ${channel.name}`}
        </Button>
        {channel.configured && (
          <Button variant="ghost" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}

// Shared by all three channel panels: the way back to the list, the channel's own description, its
// live error if it has one, and a link to whoever issues its credentials.
export function ChannelPanelHeader({
  channel,
  onBack,
}: {
  channel: MessagingPlatform;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3">
      <Button type="button" variant="ghost" size="sm" className="gap-1.5 px-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Messaging apps
      </Button>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{channel.name}</h3>
        {channel.description && <p className="text-sm text-muted-foreground">{channel.description}</p>}
      </div>
      {channelError(channel) && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {channelError(channel)}
        </p>
      )}
      {channel.docs_url && (
        <a
          href={channel.docs_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {channel.name} setup guide
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ChannelField;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.key} className="text-xs">
        {field.prompt || field.key}
        {!field.required && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </Label>
      <Input
        id={field.key}
        type={field.is_password ? "password" : "text"}
        autoComplete="off"
        value={value ?? ""}
        placeholder={field.is_set ? field.redacted_value ?? "Already set" : ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {(field.help || field.description) && (
        <p className="text-xs text-muted-foreground">{field.help || field.description}</p>
      )}
      {field.url && (
        <a
          href={field.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Where to get this
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
