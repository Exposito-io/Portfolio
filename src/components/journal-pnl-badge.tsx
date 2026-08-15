import type { JournalTradePnlSummary } from "@/lib/types";
import type { JournalMarketSummary } from "@/lib/journal-market";

export function JournalMarketMetric({
  error,
  loading,
  summary,
}: {
  error?: string;
  loading?: boolean;
  summary?: JournalMarketSummary | null;
}) {
  if (loading) {
    return <MetricShell label="Asset price" value="Loading" />;
  }

  if (error || !summary) {
    return (
      <MetricShell
        label="Asset price"
        title={error}
        value={error ? "Unavailable" : "N/A"}
      />
    );
  }

  const tone =
    summary.change24hPercent > 0
      ? "journal-pnl-metric-positive"
      : summary.change24hPercent < 0
        ? "journal-pnl-metric-negative"
        : "";

  return (
    <section className={`journal-pnl-metric journal-market-metric ${tone}`}>
      <div>
        <span>Asset price</span>
        <strong>{formatAssetPrice(summary.priceUsd)}</strong>
      </div>
      <div className="journal-market-changes">
        <MarketChange label="24h" value={summary.change24hPercent} />
        <MarketChange label="7d" value={summary.change7dPercent} />
        <MarketChange label="30d" value={summary.change30dPercent} />
      </div>
    </section>
  );
}

function MarketChange({ label, value }: { label: string; value: number }) {
  const tone =
    value > 0
      ? "journal-market-change-positive"
      : value < 0
        ? "journal-market-change-negative"
        : "";

  return (
    <div className={`journal-pnl-metric-percent ${tone}`}>
      <span>{label}</span>
      <b>{formatSignedPercent(value, 1)}</b>
    </div>
  );
}

function MetricShell({
  label,
  title,
  value,
}: {
  label: string;
  title?: string;
  value: string;
}) {
  return (
    <section className="journal-pnl-metric" title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

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
      </div>
    </section>
  );
}

export function JournalPositionValueMetric({
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
        <span>Position value</span>
        <strong>Loading</strong>
      </section>
    );
  }

  if (error) {
    return (
      <section className="journal-pnl-metric">
        <span>Position value</span>
        <strong>Unavailable</strong>
      </section>
    );
  }

  if (!summary || !isFiniteNumber(summary.positionValueUsd)) {
    return (
      <section className="journal-pnl-metric">
        <span>Position value</span>
        <strong>N/A</strong>
      </section>
    );
  }

  const pnlPercentTone = isFiniteNumber(summary.pnlPercent)
    ? summary.pnlPercent > 0
      ? "journal-market-change-positive"
      : summary.pnlPercent < 0
        ? "journal-market-change-negative"
        : ""
    : "";
  const widgetTone = isFiniteNumber(summary.pnlPercent)
    ? summary.pnlPercent > 0
      ? "journal-pnl-metric-positive"
      : summary.pnlPercent < 0
        ? "journal-pnl-metric-negative"
        : "journal-pnl-metric-neutral"
    : "journal-pnl-metric-neutral";

  return (
    <section
      className={`journal-pnl-metric ${widgetTone}`}
      title="Current Hyperliquid position value"
    >
      <div>
        <span>Position value</span>
        <strong>{formatCurrency(summary.positionValueUsd)}</strong>
      </div>
      <div className={`journal-pnl-metric-percent ${pnlPercentTone}`}>
        <span>Total PnL</span>
        <b>
          {isFiniteNumber(summary.pnlPercent)
            ? formatSignedPercent(summary.pnlPercent)
            : "N/A"}
        </b>
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

function formatSignedPercent(value: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return "N/A";

  const formatted = `${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
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

function formatAssetPrice(value: number) {
  const maximumFractionDigits = value >= 1000 ? 2 : value >= 1 ? 4 : 8;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits,
    style: "currency",
  }).format(value);
}
