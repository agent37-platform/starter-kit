export interface Shape {
  label: string;
  cpu: number;
  memory: number;
  diskMin: number;
  diskMax: number;
}

export const SHAPE_PRESETS: Shape[] = [
  { label: "Small · 1 vCPU / 3 GB", cpu: 1, memory: 3, diskMin: 6, diskMax: 20 },
  { label: "Standard · 2 vCPU / 4 GB", cpu: 2, memory: 4, diskMin: 6, diskMax: 20 },
  { label: "Pro · 4 vCPU / 8 GB", cpu: 4, memory: 8, diskMin: 20, diskMax: 40 },
  { label: "Max · 8 vCPU / 16 GB", cpu: 8, memory: 16, diskMin: 40, diskMax: 80 },
];

export const DEFAULT_AGENT = {
  template: "agent37-hermes",
  cpu: 2,
  memory: 4,
  disk: 6,
  monthlyCapUsd: 5,
} as const;

export interface AgentTypeOption {
  id: string;
  template: string;
  label: string;
  description: string;
  recommended?: boolean;
}

// The agent types offered on the create screen. This is the curated catalog —
// branded cards, in your control. Both entries run on Agent37's stock images, so this
// app needs no Docker at all. To offer your OWN image, build and register it as a
// workspace template (https://github.com/agent37-platform/custom-agent-image), then
// add an entry here whose `template` is that template's name.
export const AGENT_TYPES: AgentTypeOption[] = [
  {
    id: "hermes",
    template: "agent37-hermes",
    label: "Hermes",
    description: "General agent: chat, browsing, code, files.",
    recommended: true,
  },
  {
    id: "openclaw",
    template: "agent37-openclaw",
    label: "OpenClaw",
    description: "General agent: headless browser, code, files.",
  },
];

export const AGENT_TEMPLATES = AGENT_TYPES.map((a) => a.template);

// Labels for the "open in new tab" buttons. Ports come from the live instance
// (instance.ports), never this map — this only prettifies the ports the stock
// Hermes/OpenClaw images serve; any other port falls back to "Port {n}", which is
// what a custom image's own ports get until you add them here.
export const PORT_LABELS: Record<number, string> = {
  9119: "Dashboard",
  7681: "Terminal",
  8080: "Files",
  18789: "OpenClaw",
};
