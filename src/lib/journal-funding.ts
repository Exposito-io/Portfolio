import type { HyperliquidFundingRate } from "@/lib/types";

export type JournalFundingSummary = {
  currentAnnualizedPercent: number;
  average24hAnnualizedPercent: number | null;
  average7dAnnualizedPercent: number | null;
  average30dAnnualizedPercent: number | null;
};

const HOUR_MS = 60 * 60 * 1000;
const ANNUAL_HOURS = 24 * 365;

export function calculateJournalFundingSummary(
  rates: HyperliquidFundingRate[],
  now = Date.now(),
  currentHourlyRate?: number | null,
): JournalFundingSummary | null {
  const validRates = rates.filter(
    (rate) => Number.isFinite(rate.time) && Number.isFinite(rate.fundingRate),
  );
  if (!validRates.length) return null;

  const latest = validRates.reduce((current, rate) =>
    rate.time > current.time ? rate : current,
  );

  return {
    currentAnnualizedPercent: annualize(
      Number.isFinite(currentHourlyRate) ? (currentHourlyRate as number) : latest.fundingRate,
    ),
    average24hAnnualizedPercent: averageAnnualized(validRates, now - 24 * HOUR_MS),
    average7dAnnualizedPercent: averageAnnualized(validRates, now - 7 * 24 * HOUR_MS),
    average30dAnnualizedPercent: averageAnnualized(validRates, now - 30 * 24 * HOUR_MS),
  };
}

function averageAnnualized(rates: HyperliquidFundingRate[], cutoff: number) {
  const periodRates = rates.filter((rate) => rate.time >= cutoff);
  if (!periodRates.length) return null;

  return annualize(
    periodRates.reduce((sum, rate) => sum + rate.fundingRate, 0) /
      periodRates.length,
  );
}

function annualize(hourlyRate: number) {
  return Math.round(hourlyRate * ANNUAL_HOURS * 100 * 100) / 100;
}
