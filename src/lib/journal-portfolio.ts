export function calculatePortfolioPercent(
  positionValueUsd: number,
  portfolioInvestmentsUsd: number | null | undefined,
) {
  if (
    !Number.isFinite(positionValueUsd) ||
    typeof portfolioInvestmentsUsd !== "number" ||
    !Number.isFinite(portfolioInvestmentsUsd) ||
    portfolioInvestmentsUsd <= 0
  ) {
    return null;
  }

  return (positionValueUsd / portfolioInvestmentsUsd) * 100;
}
