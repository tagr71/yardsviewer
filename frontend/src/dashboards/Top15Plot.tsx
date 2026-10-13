import { useEffect, useState } from "react";
import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, usePlotArea, XAxis, YAxis } from "recharts";
import { useTheme } from "../theme";
import { formatHms } from "./timerCore";
import { contrastText, lineDash, plotData, plotLineLabels, runnerColors, type RankedRunner } from "./raceResults";

const DAY_COLORS = ["#0072b2", "#c43d00", "#008059", "#ab4791", "#9b7100", "#0094a4", "#d52b49", "#6952b5", "#577c10", "#ba5c1c", "#007e85", "#ae3c69", "#626d0b", "#555555", "#6c54e0"];
const NIGHT_COLORS = ["#56b4e9", "#ff914d", "#40d6a1", "#e093d0", "#f0d23d", "#39d4e7", "#ff6b81", "#b69bff", "#a7d452", "#eab676", "#66d6c4", "#ff9bbd", "#d2d878", "#d4d4d4", "#9589ff"];
const TAG_WIDTH = 164;
const TAG_HEIGHT = 18;

function RunnerTag({ name, bib, color, dash, lastLoop, slot, count, index, viewBox }: {
  name: string;
  bib: string;
  color: string;
  dash?: string;
  lastLoop: number;
  slot: number;
  count: number;
  index?: number;
  viewBox?: unknown;
}) {
  const area = usePlotArea();
  if (!area || index !== lastLoop - 1 || !viewBox || typeof viewBox !== "object") return null;
  const point = viewBox as { x?: number; y?: number };
  if (typeof point.x !== "number" || typeof point.y !== "number") return null;
  const tagX = area.x + area.width + 14;
  const tagY = count === 1
    ? Math.max(area.y, Math.min(area.y + area.height - TAG_HEIGHT, point.y - TAG_HEIGHT / 2))
    : area.y + slot * (area.height - TAG_HEIGHT) / (count - 1);
  return (
    <g className="plot-line-label" data-bib={bib}>
      <title>{name}</title>
      <path
        className="plot-label-connector"
        d={`M${point.x},${point.y} L${tagX},${tagY + TAG_HEIGHT / 2}`}
        stroke={color}
        strokeWidth={1}
        strokeDasharray={dash}
        fill="none"
      />
      <foreignObject x={tagX} y={tagY} width={TAG_WIDTH} height={TAG_HEIGHT}>
        <div className="plot-name-tag" title={name} style={{ background: color, color: contrastText(color) }}>
          {name}
        </div>
      </foreignObject>
    </g>
  );
}

export function Top15Plot({ runners, loop }: { runners: RankedRunner[]; loop: number }) {
  const [theme] = useTheme();
  const [colors, setColors] = useState(() => runnerColors(runners.map((runner) => runner.bib), new Map()));
  const activeColors = runnerColors(runners.map((runner) => runner.bib), colors);
  useEffect(() => {
    setColors((previous) => {
      const next = runnerColors(runners.map((runner) => runner.bib), previous);
      return next.size === previous.size && [...next].every(([bib, color]) => previous.get(bib) === color) ? previous : next;
    });
  }, [runners]);
  const palette = theme === "night" ? NIGHT_COLORS : DAY_COLORS;
  const data = plotData(runners, loop);
  const labels = plotLineLabels(runners, loop);
  const hasSplits = data.some((point) => Object.entries(point).some(([key, value]) => key !== "loop" && value !== null));
  if (loop === 0) return <p style={{ color: "var(--muted)" }}>Waiting for the first completed loop</p>;
  if (!runners.length) return <p style={{ color: "var(--muted)" }}>No remaining runners</p>;
  if (!hasSplits) return <p style={{ color: "var(--muted)" }}>Lap split data unavailable</p>;
  const series = runners.map((runner, index) => {
    const colorIndex = activeColors.get(runner.bib) ?? index;
    const slot = labels.findIndex((label) => label.bib === runner.bib);
    return { runner, color: palette[colorIndex], dash: lineDash(colorIndex), slot, last: labels[slot] };
  });

  return (
    <div className="top15-plot" aria-label={`Top-15 loop times through loop ${loop}`}>
      <div className="plot-canvas">
        <div className="plot-inner">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 190, bottom: 24, left: 12 }} accessibilityLayer>
              <CartesianGrid stroke="var(--subtle-border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="loop"
                type="number"
                domain={[1, Math.max(2, loop)]}
                allowDecimals={false}
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                label={{ value: "Loop", position: "bottom", fill: "var(--text)", offset: 8 }}
              />
              <YAxis
                width={70}
                tickFormatter={formatHms}
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                label={{ value: "Lap time", angle: -90, position: "insideLeft", fill: "var(--text)" }}
              />
              <Tooltip
                contentStyle={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)", fontSize: 12 }}
                labelFormatter={(value) => `Loop ${value}`}
                formatter={(value, name) => [formatHms(Number(value)), name]}
              />
              {series.map(({ runner, color, dash, slot, last }) => (
                <Line
                  key={runner.bib}
                  name={runner.name}
                  dataKey={`bib:${runner.bib}`}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={dash}
                  connectNulls={false}
                  dot={loop <= 2 ? { r: 3 } : false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                >
                  {last && (
                    <LabelList content={
                      <RunnerTag
                        name={runner.name}
                        bib={runner.bib}
                        color={color}
                        dash={dash}
                        lastLoop={last.loop}
                        slot={slot}
                        count={labels.length}
                      />
                    } />
                  )}
                </Line>
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ul className="plot-legend" aria-label="Runner legend">
        {series.map(({ runner, color, dash }) => (
          <li key={runner.bib} title={runner.name} data-bib={runner.bib}>
            <svg className="plot-swatch" width="22" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="22" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash} />
            </svg>
            <span className="runner-name">{runner.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}