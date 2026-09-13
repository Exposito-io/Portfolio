"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PORTFOLIO_TIMEZONE } from "@/lib/config";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "2-digit",
  timeZone: PORTFOLIO_TIMEZONE,
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: PORTFOLIO_TIMEZONE,
});
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function StatsPnlChart({
  points,
}: {
  points: { time: number; pnlUsd: number }[];
}) {
  return (
    <div
      className="mt-5 h-72 w-full"
      role="img"
      aria-label="Cumulative realized profit and loss in USD over the available order history"
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart
          data={points}
          margin={{ top: 10, right: 16, bottom: 8, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#e3e5e0"
          />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(time) => dateFormatter.format(time)}
            tick={{ fontSize: 12 }}
            minTickGap={40}
          />
          <YAxis
            width={72}
            tickFormatter={(value) =>
              new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                notation: "compact",
              }).format(value)
            }
            tick={{ fontSize: 12 }}
            domain={[
              (min: number) => Math.min(0, min),
              (max: number) => Math.max(0, max),
            ]}
          />
          <ReferenceLine y={0} stroke="#969e98" />
          <Tooltip
            labelFormatter={(time) => timeFormatter.format(Number(time))}
            formatter={(value) => [
              currencyFormatter.format(Number(value)),
              "Realized P/L",
            ]}
          />
          <Line
            type="stepAfter"
            dataKey="pnlUsd"
            stroke="#1f7a68"
            strokeWidth={2}
            dot={points.length === 1 ? { r: 4 } : false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
