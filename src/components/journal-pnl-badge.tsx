import type { JournalTradePnlSummary } from "@/lib/types";

export function JournalPnlBadge({
  error,
  loading,
  summary,
}: {
  error?: string;
  loading?: boolean;
  summary?: JournalTradePnlSummary | null;
}) {
  if (loading) {
    return <span className="tag">PnL loading</span>;
  }

  if (error) {
    return (
      <span className="tag" title={error}>
        PnL unavailable
      </span>
    );
  }

  if (!summary || summary.pnlUsd === null) {
    return <span className="tag">PnL N/A</span>;
  }

  const className =
    summary.pnlUsd > 0
      ? "tag tag-green"
      : summary.pnlUsd < 0
        ? "tag tag-red"
        : "tag";

  return (
    <span
      className={className}
      title={formatPnlTitle(summary)}
    >
      PnL {formatSignedCurrency(summary.pnlUsd)}
    </span>
  );
}

function formatPnlTitle(summary: JournalTradePnlSummary) {
  const parts = [
    `${summary.orderCount} filled orders`,
    `${summary.fillCount} fills`,
    `${formatCurrency(summary.notionalUsd)} notional`,
  ];

  if (summary.realizedPnlUsd !== null) {
    parts.push(`${formatSignedCurrency(summary.realizedPnlUsd)} realized`);
  }

  if (summary.unrealizedPnlUsd !== null) {
    parts.push(`${formatSignedCurrency(summary.unrealizedPnlUsd)} unrealized`);
  }

  return parts.join(", ");
}

function formatSignedCurrency(value: number) {
  const formatted = formatCurrency(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    style: "currency",
  }).format(value);
}
