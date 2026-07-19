"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import type { PortfolioPosition } from "@/lib/types";

const COLORS = [
  "#1f7a68",
  "#c27b2c",
  "#3f6f9f",
  "#8f4e3f",
  "#6f7d3c",
  "#805c9a",
  "#2e8a9e",
];

type AllocationRow = {
  symbol: string;
  valueUsd: number;
};

export function AllocationChart({
  positions,
}: {
  positions: PortfolioPosition[];
}) {
  const data = positions
    .filter((position) => position.kind === "asset" && position.valueUsd > 0)
    .reduce<AllocationRow[]>((rows, position) => {
      const existing = rows.find((row) => row.symbol === position.symbol);
      if (existing) {
        existing.valueUsd += position.valueUsd;
      } else {
        rows.push({ symbol: position.symbol, valueUsd: position.valueUsd });
      }
      return rows;
    }, [])
    .sort((a, b) => b.valueUsd - a.valueUsd);

  if (!data.length) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-black/20 text-sm text-[#6b716e]">
        Add accounts with balances to see allocation.
      </div>
    );
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="valueUsd"
            nameKey="symbol"
            innerRadius={62}
            outerRadius={104}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((row, index) => (
              <Cell key={row.symbol} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatCurrency(Number(value))}
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid rgba(0,0,0,0.14)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
