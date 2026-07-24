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

export function JournalPnlMetric({
  error,
  loading,
  summary,
}: {
  error?: string;
  loading?: boolean;
  summary?: JournalTradePnlSummary | null;
}) {
  if (loading) {
    return (
      <section className="journal-pnl-metric">
        <span>PnL</span>
        <strong>Loading</strong>
      </section>
    );
  }

  if (error) {
    return (
      <section className="journal-pnl-metric">
        <span>PnL</span>
        <strong>Unavailable</strong>
      </section>
    );
  }

  if (!summary || !isFiniteNumber(summary.pnlUsd)) {
    return (
      <section className="journal-pnl-metric">
        <span>PnL</span>
        <strong>N/A</strong>
      </section>
    );
  }

  const tone =
    summary.pnlUsd > 0
      ? "journal-pnl-metric-positive"
      : summary.pnlUsd < 0
        ? "journal-pnl-metric-negative"
        : "";

  return (
    <section className={`journal-pnl-metric ${tone}`} title={formatPnlTitle(summary)}>
      <div>
        <span>PnL</span>
        <strong>{formatSignedCurrency(summary.pnlUsd)}</strong>
      </div>
      <div className="journal-pnl-metric-percent">
        <b>
          {isFiniteNumber(summary.pnlPercent)
            ? formatSignedPercent(summary.pnlPercent)
            : "N/A"}
        </b>
        <small>of matched notional</small>
      </div>
    </section>
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

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) return "N/A";

  const formatted = `${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}%`;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
