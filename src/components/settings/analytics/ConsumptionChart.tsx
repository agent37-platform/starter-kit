"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { niceMax, runningTotal, stackedBars, ticks } from "@/lib/analytics/chart";
import { formatCompact, formatWhole } from "@/lib/analytics/format";
import type { AnalyticsOverview, ChartUnit, TabKey } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";
import { seriesColor } from "./colors";

// Hauteur de la zone de dessin et marges, en pixels ; la largeur est celle du conteneur.
const H = 240;
const PAD = { left: 44, right: 28, top: 16, bottom: 32 };
const CH = H - PAD.top - PAD.bottom;
// Largeur avant le premier rendu dans le navigateur.
const INITIAL_WIDTH = 860;
// Largeur réservée à une étiquette de date.
const LABEL_WIDTH = 64;

const UNIT_LABELS: Record<ChartUnit, string> = { tokens: "tokens", invocations: "invocations", fichiers: "fichiers" };

type Mode = "period" | "cumulative";

/** Largeur en pixels de l'élément référencé, suivie à chaque redimensionnement. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(INITIAL_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ConsumptionChart({ data, tab }: { data: AnalyticsOverview; tab: TabKey }) {
  const [mode, setMode] = useState<Mode>("period");
  const [frame, W] = useWidth<HTMLDivElement>();
  const CW = Math.max(1, W - PAD.left - PAD.right);
  const chart = data.charts[tab];
  const bars = useMemo(() => stackedBars(data.timeline, chart), [data.timeline, chart]);
  const running = useMemo(() => runningTotal(bars), [bars]);
  const max = niceMax(mode === "period" ? Math.max(0, ...bars.map((b) => b.total)) : running[running.length - 1] ?? 0);
  const activeMax = Math.max(1, ...bars.map((b) => b.expertsActive));
  const band = CW / Math.max(1, bars.length);
  const barW = Math.max(1, Math.min(28, band * 0.6));
  const labelEvery = Math.ceil(bars.length / Math.max(2, Math.floor(CW / LABEL_WIDTH)));
  const y = (v: number) => PAD.top + CH - (max > 0 ? (v / max) * CH : 0);
  const yActive = (v: number) => PAD.top + CH - (v / activeMax) * CH;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const partial = bars.findIndex((b) => b.partial);
  const readable = tab === "deliverables" ? data.readable.deliverables : data.readable.usage;
  const empty = !readable || max === 0;
  const unit = UNIT_LABELS[chart.unit];

  return (
    <div className="rounded-[22px] border border-line bg-surface p-4 shadow-xs sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-base font-bold text-ink">Consommation</h3>
        <div className="flex items-center rounded-xl border border-line bg-soft/60 p-1">
          {(
            [
              ["period", data.period === "aujourdhui" ? "Par heure" : "Par période"],
              ["cumulative", "Cumulée"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("rounded-lg px-3 py-1 text-xs font-semibold", mode === m ? "bg-surface text-ink shadow-xs" : "text-ink-3 hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={frame} className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full" role="img" aria-label={`Consommation de la période en ${unit}`}>
          {empty ? (
            <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-ink-3 text-xs">
              {readable ? "Aucune activité" : "Consommation illisible"}
            </text>
          ) : (
            <>
              {ticks(max).map((v) => (
                <g key={v}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="currentColor" strokeDasharray="3 3" className="text-line" />
                  <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="fill-ink-3 text-[10px]">
                    {formatCompact(v)}
                  </text>
                </g>
              ))}

              {mode === "period" &&
                bars.map((b, i) => {
                  let top = y(0);
                  return (
                    <g key={b.key}>
                      <title>{`${b.label} : ${formatWhole(b.total)} ${unit}`}</title>
                      {b.segments.map((s) => {
                        const h = y(0) - y(s.value);
                        top -= h;
                        const index = chart.series.findIndex((c) => c.id === s.id);
                        return <rect key={s.id} x={x(i) - barW / 2} y={top} width={barW} height={h} fill={seriesColor(s.id, index)} />;
                      })}
                    </g>
                  );
                })}

              {mode === "period" && (
                <g className="text-coral">
                  <polyline
                    points={bars.map((b, i) => `${x(i)},${yActive(b.expertsActive)}`).join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  {[activeMax, 0].map((v) => (
                    <text key={v} x={W - PAD.right + 8} y={yActive(v) + 4} className="fill-current text-[10px]">
                      {v}
                    </text>
                  ))}
                </g>
              )}

              {mode === "cumulative" && (
                <polyline
                  points={running.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  className="text-brand"
                />
              )}

              {partial >= 0 && (
                <g>
                  <line x1={x(partial)} x2={x(partial)} y1={PAD.top} y2={PAD.top + CH} stroke="currentColor" strokeDasharray="4 4" className="text-ink-3" />
                  <text x={x(partial)} y={PAD.top - 4} textAnchor="middle" className="fill-ink-3 text-[10px]">
                    En cours
                  </text>
                </g>
              )}

              {bars.map((b, i) =>
                i % labelEvery === 0 ? (
                  <text key={b.key} x={x(i)} y={H - 10} textAnchor="middle" className="fill-ink-3 text-[10px]">
                    {b.label}
                  </text>
                ) : null
              )}
            </>
          )}
        </svg>
      </div>

      {!empty && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line/60 pt-3">
          {mode === "period" &&
            chart.series.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-ink-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: seriesColor(s.id, i) }} />
                {s.name}
              </span>
            ))}
          {mode === "period" && (
            <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <span className="size-2.5 rounded-full bg-coral" />
              Experts actifs
            </span>
          )}
          {mode === "cumulative" && (
            <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <span className="size-2.5 rounded-full bg-brand" />
              {`Total cumulé (${unit})`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
