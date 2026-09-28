import type {
  HyperliquidDerivedTrade,
  HyperliquidMarginTier,
  HyperliquidSimulatedPosition,
  HyperliquidSimulationDraft,
  HyperliquidSimulationPositionDraft,
  HyperliquidSimulationResult,
  HyperliquidSimulationWarning,
  HyperliquidSimulatorMarket,
  HyperliquidSimulatorPosition,
  HyperliquidSimulatorSnapshot,
} from "@/lib/types";

const EPSILON = 1e-9;
const MAX_LIQUIDATION_PRICE = 1e15;

type WorkingPosition = HyperliquidSimulatedPosition & {
  signedSize: number;
  marginTiers: HyperliquidMarginTier[];
  sizeDecimals: number;
  maxLeverage: number;
  marketMarginMode: HyperliquidSimulatorMarket["marginMode"];
};

export function createHyperliquidSimulationDraft(
  snapshot: HyperliquidSimulatorSnapshot,
): HyperliquidSimulationDraft {
  return {
    collateralAdjustment: 0,
    positions: snapshot.positions.map((position) => ({
      id: position.id,
      marketId: position.marketId,
      targetSide: position.signedSize >= 0 ? "long" : "short",
      targetSize: Math.abs(position.signedSize),
      fillPrice: position.markPrice,
      marginMode: position.marginMode,
      leverage: position.leverage,
      isolatedMarginAdjustment: 0,
    })),
  };
}

export function simulateHyperliquidPositions(
  snapshot: HyperliquidSimulatorSnapshot,
  draft: HyperliquidSimulationDraft,
): HyperliquidSimulationResult {
  const markets = new Map(snapshot.markets.map((market) => [market.id, market]));
  const currentPositions = new Map(
    snapshot.positions.map((position) => [position.id, position]),
  );
  const warnings: HyperliquidSimulationWarning[] = [];
  const trades: HyperliquidDerivedTrade[] = [];
  const positions: WorkingPosition[] = [];
  let executionEquityImpact = 0;

  for (const positionDraft of draft.positions) {
    const market = markets.get(positionDraft.marketId);
    const current = currentPositions.get(positionDraft.id) ?? null;
    if (!market) {
      warnings.push({
        code: "missing-market",
        message: "A simulated position references a market that is unavailable.",
        positionId: positionDraft.id,
      });
      continue;
    }

    validatePositionDraft(positionDraft, market, warnings);
    const targetSignedSize =
      (positionDraft.targetSide === "long" ? 1 : -1) *
      Math.max(0, positionDraft.targetSize);
    const currentSignedSize = current?.signedSize ?? 0;
    const deltaSize = targetSignedSize - currentSignedSize;
    const markPrice = current?.markPrice || market.markPrice || 0;
    const fillPrice = positionDraft.fillPrice;
    executionEquityImpact += deltaSize * (markPrice - fillPrice);

    const changed = hasPositionChanged(current, positionDraft, targetSignedSize);
    if (Math.abs(deltaSize) > EPSILON) {
      trades.push(
        createDerivedTrade(
          positionDraft,
          market,
          currentSignedSize,
          targetSignedSize,
          deltaSize,
        ),
      );
    }

    const simulatedEntryPrice = calculateEntryPrice(
      current,
      targetSignedSize,
      fillPrice,
    );
    const simulatedMarginUsed = calculateSimulatedMargin(
      current,
      positionDraft,
      targetSignedSize,
      markPrice,
    );

    positions.push({
      id: positionDraft.id,
      marketId: market.id,
      dex: market.dex,
      coin: market.coin,
      currentSignedSize,
      targetSignedSize,
      currentEntryPrice: current?.entryPrice ?? null,
      simulatedEntryPrice,
      markPrice,
      fillPrice,
      currentLiquidationPrice: current?.liquidationPrice ?? null,
      simulatedLiquidationPrice: null,
      currentPositionValue: current?.positionValue ?? 0,
      simulatedPositionValue: Math.abs(targetSignedSize) * markPrice,
      currentMarginUsed: current?.marginUsed ?? 0,
      simulatedMarginUsed,
      marginMode: positionDraft.marginMode,
      leverage: positionDraft.leverage,
      accruedFunding: current?.accruedFunding ?? 0,
      changed,
      signedSize: targetSignedSize,
      marginTiers: market.marginTiers,
      sizeDecimals: market.sizeDecimals,
      maxLeverage: market.maxLeverage,
      marketMarginMode: market.marginMode,
    });
  }

  const simulatedAccountEquity =
    snapshot.accountEquity + draft.collateralAdjustment + executionEquityImpact;
  const isolatedMargin = positions.reduce(
    (sum, position) =>
      sum +
      (position.marginMode === "isolated" ? position.simulatedMarginUsed : 0),
    0,
  );
  const crossPositions = positions.filter(
    (position) =>
      position.marginMode === "cross" && Math.abs(position.signedSize) > EPSILON,
  );
  const scenarioChanged =
    Math.abs(draft.collateralAdjustment) > EPSILON ||
    positions.some((position) => position.changed);
  const calculatedCrossMaintenance = crossPositions.reduce(
    (sum, position) =>
      sum +
      calculateMaintenanceMargin(
        Math.abs(position.signedSize) * position.markPrice,
        position.marginTiers,
      ),
    0,
  );
  const simulatedCrossMaintenance = scenarioChanged
    ? calculatedCrossMaintenance
    : snapshot.crossMaintenance;
  const crossAvailable = simulatedAccountEquity - isolatedMargin;
  const simulatedMarginBuffer = crossAvailable - simulatedCrossMaintenance;

  validateAccountMargin(
    draft,
    positions,
    crossAvailable,
    simulatedMarginBuffer,
    warnings,
  );

  for (const position of positions) {
    if (Math.abs(position.signedSize) <= EPSILON) continue;
    if (!scenarioChanged) {
      position.simulatedLiquidationPrice = position.currentLiquidationPrice;
      continue;
    }
    position.simulatedLiquidationPrice =
      position.marginMode === "cross"
        ? solveLiquidationPrice(position, (candidatePrice) => {
            const candidateEquity =
              crossAvailable +
              position.signedSize * (candidatePrice - position.markPrice);
            const candidateMaintenance =
              simulatedCrossMaintenance -
              calculateMaintenanceMargin(
                Math.abs(position.signedSize) * position.markPrice,
                position.marginTiers,
              ) +
              calculateMaintenanceMargin(
                Math.abs(position.signedSize) * candidatePrice,
                position.marginTiers,
              );
            return candidateEquity - candidateMaintenance;
          })
        : solveLiquidationPrice(position, (candidatePrice) => {
            const candidateEquity =
              position.simulatedMarginUsed +
              position.signedSize * (candidatePrice - position.markPrice);
            return (
              candidateEquity -
              calculateMaintenanceMargin(
                Math.abs(position.signedSize) * candidatePrice,
                position.marginTiers,
              )
            );
          });
  }

  const nearestLiquidation = positions.reduce<
    HyperliquidSimulationResult["metrics"]["nearestLiquidation"]
  >((nearest, position) => {
    const price = position.simulatedLiquidationPrice;
    if (price === null || position.markPrice <= 0) return nearest;
    const distancePercent =
      (Math.abs(price - position.markPrice) / position.markPrice) * 100;
    return !nearest || distancePercent < nearest.distancePercent
      ? { coin: position.coin, price, distancePercent }
      : nearest;
  }, null);

  return {
    metrics: {
      currentAccountEquity: snapshot.accountEquity,
      simulatedAccountEquity,
      currentCrossMaintenance: snapshot.crossMaintenance,
      simulatedCrossMaintenance,
      currentMarginBuffer:
        snapshot.accountEquity - snapshot.isolatedMargin - snapshot.crossMaintenance,
      simulatedMarginBuffer,
      nearestLiquidation,
    },
    positions: positions.map(stripWorkingFields),
    trades,
    warnings,
  };
}

export function calculateMaintenanceMargin(
  notional: number,
  tiers: HyperliquidMarginTier[],
) {
  if (notional <= 0 || !tiers.length) return 0;
  const ordered = [...tiers].sort((a, b) => a.lowerBound - b.lowerBound);
  let selected = ordered[0];
  let previousRate = 1 / (2 * selected.maxLeverage);
  let deduction = 0;

  for (const tier of ordered.slice(1)) {
    const rate = 1 / (2 * tier.maxLeverage);
    if (notional < tier.lowerBound) break;
    deduction += tier.lowerBound * (rate - previousRate);
    previousRate = rate;
    selected = tier;
  }

  return Math.max(0, notional / (2 * selected.maxLeverage) - deduction);
}

function calculateEntryPrice(
  current: HyperliquidSimulatorPosition | null,
  targetSignedSize: number,
  fillPrice: number,
) {
  if (Math.abs(targetSignedSize) <= EPSILON) return null;
  if (!current || Math.abs(current.signedSize) <= EPSILON) return fillPrice;
  if (Math.sign(current.signedSize) !== Math.sign(targetSignedSize)) {
    return fillPrice;
  }
  if (Math.abs(targetSignedSize) <= Math.abs(current.signedSize)) {
    return current.entryPrice;
  }
  const addedSize = Math.abs(targetSignedSize) - Math.abs(current.signedSize);
  return (
    (Math.abs(current.signedSize) * current.entryPrice + addedSize * fillPrice) /
    Math.abs(targetSignedSize)
  );
}

function calculateSimulatedMargin(
  current: HyperliquidSimulatorPosition | null,
  draft: HyperliquidSimulationPositionDraft,
  targetSignedSize: number,
  markPrice: number,
) {
  if (Math.abs(targetSignedSize) <= EPSILON) {
    return 0;
  }
  if (draft.marginMode === "cross") {
    return (Math.abs(targetSignedSize) * markPrice) / draft.leverage;
  }

  const targetAbs = Math.abs(targetSignedSize);
  const currentAbs = Math.abs(current?.signedSize ?? 0);
  const sameSide =
    current && Math.sign(current.signedSize) === Math.sign(targetSignedSize);
  let margin: number;

  if (current?.marginMode === "isolated" && sameSide && currentAbs > 0) {
    if (targetAbs <= currentAbs) {
      margin = current.marginUsed * (targetAbs / currentAbs);
    } else {
      const addedSize = targetAbs - currentAbs;
      const signedAdded = Math.sign(targetSignedSize) * addedSize;
      margin =
        current.marginUsed +
        (addedSize * draft.fillPrice) / draft.leverage +
        signedAdded * (markPrice - draft.fillPrice);
    }
  } else {
    margin =
      (targetAbs * draft.fillPrice) / draft.leverage +
      targetSignedSize * (markPrice - draft.fillPrice);
  }

  return Math.max(0, margin + draft.isolatedMarginAdjustment);
}

function solveLiquidationPrice(
  position: WorkingPosition,
  bufferAtPrice: (price: number) => number,
) {
  const markPrice = position.markPrice;
  if (markPrice <= 0 || Math.abs(position.signedSize) <= EPSILON) return null;
  const markBuffer = bufferAtPrice(markPrice);
  if (markBuffer <= 0) return markPrice;

  let low: number;
  let high: number;
  if (position.signedSize > 0) {
    low = 0;
    high = markPrice;
    if (bufferAtPrice(low) > 0) return null;
  } else {
    low = markPrice;
    high = Math.max(markPrice * 2, markPrice + 1);
    while (bufferAtPrice(high) > 0 && high < MAX_LIQUIDATION_PRICE) {
      high *= 2;
    }
    if (high >= MAX_LIQUIDATION_PRICE && bufferAtPrice(high) > 0) return null;
  }

  for (let index = 0; index < 100; index += 1) {
    const midpoint = (low + high) / 2;
    const buffer = bufferAtPrice(midpoint);
    if (position.signedSize > 0) {
      if (buffer > 0) high = midpoint;
      else low = midpoint;
    } else if (buffer > 0) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  const liquidationPrice = (low + high) / 2;
  return liquidationPrice > 0 && liquidationPrice < MAX_LIQUIDATION_PRICE
    ? liquidationPrice
    : null;
}

function validatePositionDraft(
  draft: HyperliquidSimulationPositionDraft,
  market: HyperliquidSimulatorMarket,
  warnings: HyperliquidSimulationWarning[],
) {
  if (!Number.isFinite(draft.fillPrice) || draft.fillPrice <= 0) {
    warnings.push({
      code: "invalid-fill",
      message: `${market.coin} needs a positive assumed fill price.`,
      positionId: draft.id,
    });
  }
  if (
    !Number.isInteger(draft.leverage) ||
    draft.leverage < 1 ||
    draft.leverage > market.maxLeverage
  ) {
    warnings.push({
      code: "invalid-leverage",
      message: `${market.coin} leverage must be an integer from 1x to ${market.maxLeverage}x.`,
      positionId: draft.id,
    });
  }
  const precision = 10 ** market.sizeDecimals;
  if (
    !Number.isFinite(draft.targetSize) ||
    draft.targetSize < 0 ||
    Math.abs(draft.targetSize * precision - Math.round(draft.targetSize * precision)) >
      EPSILON
  ) {
    warnings.push({
      code: "invalid-size",
      message: `${market.coin} size supports at most ${market.sizeDecimals} decimal places.`,
      positionId: draft.id,
    });
  }
  if (draft.marginMode === "cross" && market.marginMode !== "cross") {
    warnings.push({
      code: "unsupported-margin-mode",
      message: `${market.coin} only supports isolated margin.`,
      positionId: draft.id,
    });
  }
}

function validateAccountMargin(
  draft: HyperliquidSimulationDraft,
  positions: WorkingPosition[],
  crossAvailable: number,
  marginBuffer: number,
  warnings: HyperliquidSimulationWarning[],
) {
  const crossPositions = positions.filter(
    (position) =>
      position.marginMode === "cross" && Math.abs(position.signedSize) > EPSILON,
  );
  const requiredInitialMargin = crossPositions.reduce(
    (sum, position) =>
      sum +
      (Math.abs(position.signedSize) * position.fillPrice) / position.leverage,
    0,
  );
  const crossNotional = crossPositions.reduce(
    (sum, position) =>
      sum + Math.abs(position.signedSize) * position.markPrice,
    0,
  );
  if (crossAvailable + EPSILON < requiredInitialMargin) {
    warnings.push({
      code: "insufficient-initial-margin",
      message: `The scenario needs ${formatUsd(requiredInitialMargin - crossAvailable)} more cross collateral to meet its selected leverage.`,
    });
  }
  if (
    draft.collateralAdjustment < 0 &&
    crossAvailable + EPSILON < Math.max(requiredInitialMargin, crossNotional * 0.1)
  ) {
    warnings.push({
      code: "unsafe-collateral-removal",
      message:
        "The simulated withdrawal leaves less than Hyperliquid's transfer-margin requirement.",
    });
  }
  if (marginBuffer <= 0) {
    warnings.push({
      code: "liquidatable",
      message: "The simulated cross-margin pool is at or below maintenance margin.",
    });
  }
  for (const position of positions) {
    if (
      position.marginMode === "isolated" &&
      Math.abs(position.signedSize) > EPSILON &&
      position.simulatedMarginUsed <=
        calculateMaintenanceMargin(
          position.simulatedPositionValue,
          position.marginTiers,
        )
    ) {
      warnings.push({
        code: "liquidatable",
        message: `${position.coin} is at or below isolated maintenance margin.`,
        positionId: position.id,
      });
    }
  }
}

function hasPositionChanged(
  current: HyperliquidSimulatorPosition | null,
  draft: HyperliquidSimulationPositionDraft,
  targetSignedSize: number,
) {
  if (!current) return Math.abs(targetSignedSize) > EPSILON;
  const sizeChanged =
    Math.abs(targetSignedSize - current.signedSize) > EPSILON;
  return (
    sizeChanged ||
    draft.marginMode !== current.marginMode ||
    draft.leverage !== current.leverage ||
    Math.abs(draft.isolatedMarginAdjustment) > EPSILON
  );
}

function createDerivedTrade(
  draft: HyperliquidSimulationPositionDraft,
  market: HyperliquidSimulatorMarket,
  currentSignedSize: number,
  targetSignedSize: number,
  deltaSize: number,
): HyperliquidDerivedTrade {
  const currentSide = currentSignedSize >= 0 ? "long" : "short";
  const targetSide = targetSignedSize >= 0 ? "long" : "short";
  let description: string;
  if (Math.abs(targetSignedSize) <= EPSILON) {
    description = `Close ${market.coin} ${currentSide}`;
  } else if (Math.abs(currentSignedSize) <= EPSILON) {
    description = `Open ${market.coin} ${targetSide}`;
  } else if (Math.sign(currentSignedSize) !== Math.sign(targetSignedSize)) {
    description = `Flip ${market.coin} to ${targetSide}`;
  } else if (Math.abs(targetSignedSize) > Math.abs(currentSignedSize)) {
    description = `Increase ${market.coin} ${targetSide} by ${formatSize(Math.abs(deltaSize), market.sizeDecimals)}`;
  } else {
    description = `Reduce ${market.coin} ${targetSide} by ${formatSize(Math.abs(deltaSize), market.sizeDecimals)}`;
  }
  return {
    positionId: draft.id,
    marketId: market.id,
    coin: market.coin,
    deltaSize,
    fillPrice: draft.fillPrice,
    description,
  };
}

function stripWorkingFields(position: WorkingPosition): HyperliquidSimulatedPosition {
  return {
    id: position.id,
    marketId: position.marketId,
    dex: position.dex,
    coin: position.coin,
    currentSignedSize: position.currentSignedSize,
    targetSignedSize: position.targetSignedSize,
    currentEntryPrice: position.currentEntryPrice,
    simulatedEntryPrice: position.simulatedEntryPrice,
    markPrice: position.markPrice,
    fillPrice: position.fillPrice,
    currentLiquidationPrice: position.currentLiquidationPrice,
    simulatedLiquidationPrice: position.simulatedLiquidationPrice,
    currentPositionValue: position.currentPositionValue,
    simulatedPositionValue: position.simulatedPositionValue,
    currentMarginUsed: position.currentMarginUsed,
    simulatedMarginUsed: position.simulatedMarginUsed,
    marginMode: position.marginMode,
    leverage: position.leverage,
    accruedFunding: position.accruedFunding,
    changed: position.changed,
  };
}

function formatSize(value: number, decimals: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
  });
}

function formatUsd(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
