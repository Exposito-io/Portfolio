import type { JournalTradePnlSummary } from "@/lib/types";
import type { JournalFundingSummary } from "@/lib/journal-funding";
import type { JournalMarketSummary } from "@/lib/journal-market";
import { calculatePortfolioPercent } from "@/lib/journal-portfolio";

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

export function JournalFundingMetric({
  error,
  loading,
  summary,
}: {
  error?: string;
  loading?: boolean;
  summary?: JournalFundingSummary | null;
}) {
  if (loading) {
    return <MetricShell label="Funding rate" value="Loading" />;
  }

  if (error || !summary) {
    return (
      <MetricShell
        label="Funding rate"
        title={error}
        value={error ? "Unavailable" : "N/A"}
      />
    );
  }

  const tone = getMetricTone(summary.currentAnnualizedPercent);

  return (
    <section className={`journal-pnl-metric journal-market-metric ${tone}`}>
      <div>
        <span>Current funding rate</span>
        <strong>{formatSignedPercent(summary.currentAnnualizedPercent)}</strong>
      </div>
      <div className="journal-market-changes">
        <FundingAverage label="Avg 24h" value={summary.average24hAnnualizedPercent} />
        <FundingAverage label="Avg 7d" value={summary.average7dAnnualizedPercent} />
        <FundingAverage label="Avg 30d" value={summary.average30dAnnualizedPercent} />
      </div>
    </section>
  );
}

function FundingAverage({ label, value }: { label: string; value: number | null }) {
  const tone = isFiniteNumber(value)
    ? value > 0
      ? "journal-market-change-positive"
      : value < 0
        ? "journal-market-change-negative"
        : ""
    : "";

  return (
    <div className={`journal-pnl-metric-percent ${tone}`}>
      <span>{label}</span>
      <b>{isFiniteNumber(value) ? formatSignedPercent(value) : "N/A"}</b>
    </div>
  );
}

function getMetricTone(value: number) {
  return value > 0
    ? "journal-pnl-metric-positive"
    : value < 0
      ? "journal-pnl-metric-negative"
      : "";
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
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
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
      <div className="journal-pnl-breakdown">
        <PnlBreakdownItem
          label="Transactions PnL"
          percent={calculatePnlPercent(summary.realizedPnlUsd, summary.notionalUsd)}
          value={summary.realizedPnlUsd}
        />
        <PnlBreakdownItem
          label="Unrealized PnL"
          percent={calculatePnlPercent(summary.unrealizedPnlUsd, summary.notionalUsd)}
          value={summary.unrealizedPnlUsd}
        />
        <PnlBreakdownItem
          label="Total PnL"
          percent={summary.pnlPercent}
          value={summary.pnlUsd}
        />
      </div>
    </section>
  );
}

export function JournalEntryPriceMetric({
  error,
  loading,
  summary,
}: {
  error?: string;
  loading?: boolean;
  summary?: JournalTradePnlSummary | null;
}) {
  if (loading) {
    return <MetricShell label="Entry price" value="Loading" />;
  }

  if (error) {
    return <MetricShell label="Entry price" title={error} value="Unavailable" />;
  }

  return (
    <MetricShell
      label="Entry price"
      value={
        summary && isFiniteNumber(summary.entryPriceUsd)
          ? formatAssetPrice(summary.entryPriceUsd)
          : "N/A"
      }
    />
  );
}

function PnlBreakdownItem({
  label,
  percent,
  value,
}: {
  label: string;
  percent: number | null;
  value: number | null;
}) {
  const tone = isFiniteNumber(value)
    ? value > 0
      ? "journal-market-change-positive"
      : value < 0
        ? "journal-market-change-negative"
        : ""
    : "";

  return (
    <div className={`journal-pnl-breakdown-item ${tone}`}>
      <span>{label}</span>
      <b>{isFiniteNumber(value) ? formatSignedCurrency(value) : "N/A"}</b>
      <small className="journal-pnl-breakdown-percent">
        {isFiniteNumber(percent) ? formatSignedPercent(percent) : "N/A"}
      </small>
    </div>
  );
}

function calculatePnlPercent(value: number | null, notionalUsd: number) {
  if (!isFiniteNumber(value) || !isFiniteNumber(notionalUsd) || notionalUsd === 0) {
    return null;
  }

  return Math.round((value / notionalUsd) * 10_000) / 100;
}

export function JournalPositionValueMetric({
  error,
  loading,
  portfolioError,
  portfolioInvestmentsUsd,
  portfolioLoading,
  summary,
}: {
  error?: string;
  loading?: boolean;
  portfolioError?: string;
  portfolioInvestmentsUsd?: number | null;
  portfolioLoading?: boolean;
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

  const portfolioPercent = calculatePortfolioPercent(
    summary.positionValueUsd,
    portfolioInvestmentsUsd,
  );
  const widgetTone = "journal-pnl-metric-neutral";

  return (
    <section
      className={`journal-pnl-metric ${widgetTone}`}
      title="Current Hyperliquid position value"
    >
      <div>
        <span>Position value</span>
        <strong>{formatCurrency(summary.positionValueUsd)}</strong>
      </div>
      <div
        className="journal-pnl-metric-percent"
        title={portfolioError || undefined}
      >
        <span>Of portfolio</span>
        <b>{portfolioLoading ? "Loading" : formatPortfolioPercent(portfolioPercent)}</b>
      </div>
    </section>
  );
}

function formatPortfolioPercent(value: number | null) {
  if (!isFiniteNumber(value)) return "N/A";

  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}%`;
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
