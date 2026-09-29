import type {
  HyperliquidDerivedTrade,
  HyperliquidMarginTier,
  HyperliquidSimulatedPosition,
  HyperliquidSimulationDraft,
  HyperliquidSimulationOrder,
  HyperliquidSimulationOrderInput,
  HyperliquidSimulationOrderPreview,
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
      orders: [],
    })),
  };
}

export function createHyperliquidOrderPreview(
  snapshot: HyperliquidSimulatorSnapshot,
  draft: HyperliquidSimulationDraft,
  input: HyperliquidSimulationOrderInput,
): HyperliquidSimulationOrderPreview {
  const market = snapshot.markets.find((item) => item.id === input.marketId);
  const errors: string[] = [];
  if (!market) errors.push("Select an available market.");
  if (!Number.isFinite(input.requestedNotional) || input.requestedNotional <= 0) {
    errors.push("Order value must be greater than zero.");
  }
  if (!Number.isFinite(input.fillPrice) || input.fillPrice <= 0) {
    errors.push("Assumed fill price must be greater than zero.");
  }
  if (
    !Number.isInteger(input.leverage) ||
    input.leverage < 1 ||
    (market && input.leverage > market.maxLeverage)
  ) {
    errors.push(
      market
        ? `Leverage must be an integer from 1x to ${market.maxLeverage}x.`
        : "Enter a valid leverage.",
    );
  }
  if (market && input.marginMode === "cross" && market.marginMode !== "cross") {
    errors.push(`${market.coin} only supports isolated margin.`);
  }

  const baseResult = simulateHyperliquidPositions(snapshot, draft);
  const currentPosition = baseResult.positions.find(
    (position) => position.marketId === input.marketId,
  );
  const currentSignedSize = currentPosition?.targetSignedSize ?? 0;
  const liquidationPriceBefore =
    currentPosition?.simulatedLiquidationPrice ?? null;
  const size =
    market && input.fillPrice > 0 && input.requestedNotional > 0
      ? quantizeOrderSize(
          input.requestedNotional / input.fillPrice,
          market.sizeDecimals,
        )
      : 0;
  if (market && size <= 0 && input.requestedNotional > 0 && input.fillPrice > 0) {
    errors.push(
      `Order value is too small for ${market.coin}'s ${market.sizeDecimals}-decimal size precision.`,
    );
  }
  const deltaSize = (input.side === "buy" ? 1 : -1) * size;
  const resultingSignedSize = normalizeSignedSize(
    currentSignedSize + deltaSize,
    market?.sizeDecimals ?? 8,
  );
  const openingSize = calculateOpeningSize(currentSignedSize, deltaSize);
  const effectiveNotional = size * input.fillPrice;
  const additionalInitialMargin =
    input.leverage > 0 ? (openingSize * input.fillPrice) / input.leverage : 0;

  if (!market || errors.length) {
    return {
      order: null,
      draft: null,
      result: null,
      currentSignedSize,
      resultingSignedSize,
      liquidationPriceBefore,
      liquidationPriceAfter: null,
      marginBefore: currentPosition?.simulatedMarginUsed ?? 0,
      marginAfter: currentPosition?.simulatedMarginUsed ?? 0,
      marginChange: 0,
      errors,
    };
  }

  const order: HyperliquidSimulationOrder = {
    id: input.id,
    marketId: input.marketId,
    side: input.side,
    requestedNotional: input.requestedNotional,
    effectiveNotional,
    size,
    fillPrice: input.fillPrice,
    marginMode: input.marginMode,
    leverage: input.leverage,
    additionalInitialMargin,
    marginImpact: 0,
  };
  const existingDraft = draft.positions.find(
    (position) => position.marketId === input.marketId,
  );
  const positionId = existingDraft?.id ?? `new:${market.id}`;
  const nextPosition: HyperliquidSimulationPositionDraft = existingDraft
    ? {
        ...existingDraft,
        marginMode: input.marginMode,
        leverage: input.leverage,
        orders: [...existingDraft.orders, order],
      }
    : {
        id: positionId,
        marketId: market.id,
        targetSide: input.side === "buy" ? "long" : "short",
        targetSize: 0,
        fillPrice: market.markPrice,
        marginMode: input.marginMode,
        leverage: input.leverage,
        isolatedMarginAdjustment: 0,
        orders: [order],
      };
  let nextDraft: HyperliquidSimulationDraft = {
    ...draft,
    positions: existingDraft
      ? draft.positions.map((position) =>
          position.id === existingDraft.id ? nextPosition : position,
        )
      : [...draft.positions, nextPosition],
  };
  let result = simulateHyperliquidPositions(snapshot, nextDraft);
  const marginBefore = currentPosition?.simulatedMarginUsed ?? 0;
  const marginAfter =
    result.positions.find((position) => position.id === positionId)
      ?.simulatedMarginUsed ?? 0;
  const marginImpact = marginAfter - marginBefore;
  const completedOrder = { ...order, marginImpact };
  nextDraft = {
    ...nextDraft,
    positions: nextDraft.positions.map((position) =>
      position.id === positionId
        ? {
            ...position,
            orders: position.orders.map((item) =>
              item.id === completedOrder.id ? completedOrder : item,
            ),
          }
        : position,
    ),
  };
  result = simulateHyperliquidPositions(snapshot, nextDraft);
  const liquidationPriceAfter =
    result.positions.find((position) => position.id === positionId)
      ?.simulatedLiquidationPrice ?? null;

  return {
    order: completedOrder,
    draft: nextDraft,
    result,
    currentSignedSize,
    resultingSignedSize,
    liquidationPriceBefore,
    liquidationPriceAfter,
    marginBefore,
    marginAfter,
    marginChange: marginImpact,
    errors,
  };
}

export function quantizeOrderSize(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const precision = 10 ** decimals;
  return Math.floor((value + EPSILON) * precision) / precision;
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

    const manualTargetSignedSize =
      (positionDraft.targetSide === "long" ? 1 : -1) *
      Math.max(0, positionDraft.targetSize);
    const currentSignedSize = current?.signedSize ?? 0;
    const markPrice = current?.markPrice || market.markPrice || 0;
    const manualDeltaSize = manualTargetSignedSize - currentSignedSize;
    let targetSignedSize = manualTargetSignedSize;
    let simulatedEntryPrice = calculateEntryPrice(
      current,
      manualTargetSignedSize,
      positionDraft.fillPrice,
    );
    let fillPrice = positionDraft.fillPrice;
    executionEquityImpact +=
      manualDeltaSize * (markPrice - positionDraft.fillPrice);
    if (Math.abs(manualDeltaSize) > EPSILON) {
      trades.push(
        createDerivedTrade(
          positionDraft,
          market,
          currentSignedSize,
          manualTargetSignedSize,
          manualDeltaSize,
        ),
      );
    }

    for (const order of positionDraft.orders) {
      const deltaSize = (order.side === "buy" ? 1 : -1) * order.size;
      const beforeSignedSize = targetSignedSize;
      const nextSignedSize = normalizeSignedSize(
        beforeSignedSize + deltaSize,
        market.sizeDecimals,
      );
      simulatedEntryPrice = applyExecutionToEntryPrice(
        beforeSignedSize,
        simulatedEntryPrice,
        nextSignedSize,
        order.fillPrice,
      );
      executionEquityImpact += deltaSize * (markPrice - order.fillPrice);
      trades.push(createOrderDerivedTrade(positionDraft, market, order, deltaSize));
      targetSignedSize = nextSignedSize;
      fillPrice = order.fillPrice;
    }

    validatePositionDraft(
      positionDraft,
      market,
      targetSignedSize,
      fillPrice,
      warnings,
    );
    const changed = hasPositionChanged(current, positionDraft, targetSignedSize);
    const simulatedMarginUsed = calculateSimulatedMarginWithOrders(
      current,
      positionDraft,
      manualTargetSignedSize,
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

function calculateSimulatedMarginWithOrders(
  current: HyperliquidSimulatorPosition | null,
  draft: HyperliquidSimulationPositionDraft,
  manualTargetSignedSize: number,
  targetSignedSize: number,
  markPrice: number,
) {
  if (Math.abs(targetSignedSize) <= EPSILON) return 0;
  if (draft.marginMode === "cross") {
    return (Math.abs(targetSignedSize) * markPrice) / draft.leverage;
  }

  const withoutAdjustment = { ...draft, isolatedMarginAdjustment: 0 };
  let margin = calculateSimulatedMargin(
    current,
    withoutAdjustment,
    manualTargetSignedSize,
    markPrice,
  );
  let signedSize = manualTargetSignedSize;
  let previousMode: "cross" | "isolated" = draft.marginMode;

  for (const order of draft.orders) {
    const deltaSize = (order.side === "buy" ? 1 : -1) * order.size;
    const nextSignedSize = signedSize + deltaSize;
    if (order.marginMode !== "isolated") {
      margin = (Math.abs(nextSignedSize) * markPrice) / order.leverage;
    } else if (previousMode !== "isolated") {
      margin =
        (Math.abs(nextSignedSize) * order.fillPrice) / order.leverage +
        nextSignedSize * (markPrice - order.fillPrice);
    } else {
      margin = applyIsolatedOrderMargin(
        margin,
        signedSize,
        nextSignedSize,
        order.fillPrice,
        order.leverage,
        markPrice,
      );
    }
    signedSize = nextSignedSize;
    previousMode = order.marginMode;
  }

  return Math.max(0, margin + draft.isolatedMarginAdjustment);
}

function applyIsolatedOrderMargin(
  currentMargin: number,
  beforeSignedSize: number,
  afterSignedSize: number,
  fillPrice: number,
  leverage: number,
  markPrice: number,
) {
  const beforeAbs = Math.abs(beforeSignedSize);
  const afterAbs = Math.abs(afterSignedSize);
  if (afterAbs <= EPSILON) return 0;
  if (beforeAbs <= EPSILON || Math.sign(beforeSignedSize) !== Math.sign(afterSignedSize)) {
    return Math.max(
      0,
      (afterAbs * fillPrice) / leverage +
        afterSignedSize * (markPrice - fillPrice),
    );
  }
  if (afterAbs <= beforeAbs) {
    return currentMargin * (afterAbs / beforeAbs);
  }
  const addedSize = afterAbs - beforeAbs;
  const signedAdded = Math.sign(afterSignedSize) * addedSize;
  return Math.max(
    0,
    currentMargin +
      (addedSize * fillPrice) / leverage +
      signedAdded * (markPrice - fillPrice),
  );
}

function applyExecutionToEntryPrice(
  beforeSignedSize: number,
  beforeEntryPrice: number | null,
  afterSignedSize: number,
  fillPrice: number,
) {
  if (Math.abs(afterSignedSize) <= EPSILON) return null;
  if (
    Math.abs(beforeSignedSize) <= EPSILON ||
    beforeEntryPrice === null ||
    Math.sign(beforeSignedSize) !== Math.sign(afterSignedSize)
  ) {
    return fillPrice;
  }
  if (Math.abs(afterSignedSize) <= Math.abs(beforeSignedSize)) {
    return beforeEntryPrice;
  }
  const addedSize = Math.abs(afterSignedSize) - Math.abs(beforeSignedSize);
  return (
    (Math.abs(beforeSignedSize) * beforeEntryPrice + addedSize * fillPrice) /
    Math.abs(afterSignedSize)
  );
}

function calculateOpeningSize(beforeSignedSize: number, deltaSize: number) {
  if (Math.abs(deltaSize) <= EPSILON) return 0;
  if (
    Math.abs(beforeSignedSize) <= EPSILON ||
    Math.sign(beforeSignedSize) === Math.sign(deltaSize)
  ) {
    return Math.abs(deltaSize);
  }
  return Math.max(0, Math.abs(deltaSize) - Math.abs(beforeSignedSize));
}

function normalizeSignedSize(value: number, decimals: number) {
  const precision = 10 ** decimals;
  const normalized = Math.round(value * precision) / precision;
  return Math.abs(normalized) <= EPSILON ? 0 : normalized;
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
  targetSignedSize: number,
  fillPrice: number,
  warnings: HyperliquidSimulationWarning[],
) {
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
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
    !Number.isFinite(targetSignedSize) ||
    Math.abs(targetSignedSize * precision - Math.round(targetSignedSize * precision)) >
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
    draft.orders.length > 0 ||
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
    orderId: null,
    requestedNotional: null,
    effectiveNotional: Math.abs(deltaSize) * draft.fillPrice,
    additionalInitialMargin:
      (calculateOpeningSize(currentSignedSize, deltaSize) * draft.fillPrice) /
      draft.leverage,
    marginImpact: 0,
  };
}

function createOrderDerivedTrade(
  draft: HyperliquidSimulationPositionDraft,
  market: HyperliquidSimulatorMarket,
  order: HyperliquidSimulationOrder,
  deltaSize: number,
): HyperliquidDerivedTrade {
  return {
    positionId: draft.id,
    marketId: market.id,
    coin: market.coin,
    deltaSize,
    fillPrice: order.fillPrice,
    description: `${order.side === "buy" ? "Buy" : "Sell"} ${formatOrderUsd(order.requestedNotional)} of ${market.coin}`,
    orderId: order.id,
    requestedNotional: order.requestedNotional,
    effectiveNotional: order.effectiveNotional,
    additionalInitialMargin: order.additionalInitialMargin,
    marginImpact: order.marginImpact,
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

function formatOrderUsd(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
