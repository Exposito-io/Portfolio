import { AaveV3Ethereum } from "@bgd-labs/aave-address-book";
import {
  createPublicClient,
  formatUnits,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

import { requireEthereumRpcUrl } from "@/lib/config";
import { roundCurrency } from "@/lib/portfolio-calculations";
import type {
  AaveReserveHint,
  PortfolioAccount,
  PortfolioPosition,
  SourceSummary,
} from "@/lib/types";

const poolAbi = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
] as const;

const protocolDataProviderAbi = [
  {
    type: "function",
    name: "getUserReserveData",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "currentATokenBalance", type: "uint256" },
      { name: "currentStableDebt", type: "uint256" },
      { name: "currentVariableDebt", type: "uint256" },
      { name: "principalStableDebt", type: "uint256" },
      { name: "scaledVariableDebt", type: "uint256" },
      { name: "stableBorrowRate", type: "uint256" },
      { name: "liquidityRate", type: "uint256" },
      { name: "stableRateLastUpdated", type: "uint40" },
      { name: "usageAsCollateralEnabled", type: "bool" },
    ],
  },
] as const;

const oracleAbi = [
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "price", type: "uint256" }],
  },
  {
    type: "function",
    name: "BASE_CURRENCY_UNIT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "unit", type: "uint256" }],
  },
] as const;

type AaveAsset = {
  symbol: string;
  address: Address;
  decimals: number;
};

export type AaveAccountResult = {
  summary: SourceSummary;
  positions: PortfolioPosition[];
};

export function createEthereumClient(): PublicClient {
  return createPublicClient({
    chain: mainnet,
    transport: http(requireEthereumRpcUrl()),
  });
}

export async function fetchAaveAccount(
  account: PortfolioAccount,
  client = createEthereumClient(),
  reserveHints?: AaveReserveHint[] | null,
): Promise<AaveAccountResult> {
  const user = account.address as Address;
  const allAssets = getAaveAssets();
  const assets = reserveHints?.length
    ? reserveHints.map((hint) => ({
        symbol: hint.symbol,
        address: hint.address as Address,
        decimals: hint.decimals,
      }))
    : allAssets;
  const [accountData, baseCurrencyUnit, reserveData] = await Promise.all([
    client.readContract({
      address: AaveV3Ethereum.POOL as Address,
      abi: poolAbi,
      functionName: "getUserAccountData",
      args: [user],
    }),
    client.readContract({
      address: AaveV3Ethereum.ORACLE as Address,
      abi: oracleAbi,
      functionName: "BASE_CURRENCY_UNIT",
    }),
    client.multicall({
      allowFailure: false,
      contracts: assets.map((asset) => ({
        address: AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER as Address,
        abi: protocolDataProviderAbi,
        functionName: "getUserReserveData",
        args: [asset.address, user],
      })),
    }),
  ]);

  const activeReserves = reserveData
    .map((data, index) => ({
      asset: assets[index],
      data,
      supplied: Number(formatUnits(data[0], assets[index].decimals)),
      stableDebt: Number(formatUnits(data[1], assets[index].decimals)),
      variableDebt: Number(formatUnits(data[2], assets[index].decimals)),
    }))
    .filter((reserve) => {
      return (
        reserve.supplied > 0 ||
        reserve.stableDebt > 0 ||
        reserve.variableDebt > 0
      );
    });

  const prices = activeReserves.length
    ? await client.multicall({
        allowFailure: false,
        contracts: activeReserves.map((reserve) => ({
          address: AaveV3Ethereum.ORACLE as Address,
          abi: oracleAbi,
          functionName: "getAssetPrice",
          args: [reserve.asset.address],
        })),
      })
    : [];

  const positions = activeReserves.flatMap((reserve, index) => {
    const priceUsd = Number(prices[index]) / Number(baseCurrencyUnit);
    const { asset, data, supplied, stableDebt, variableDebt } = reserve;
    const debt = stableDebt + variableDebt;
    const rows: PortfolioPosition[] = [];

    if (supplied > 0) {
      rows.push({
        id: `${account.id}:aave:${asset.symbol}:supply`,
        accountId: account.id,
        accountLabel: account.label,
        source: "aave",
        symbol: asset.symbol,
        name: `${asset.symbol} supplied on Aave`,
        kind: "asset",
        quantity: supplied,
        valueUsd: roundCurrency(supplied * priceUsd),
        debtUsd: 0,
        details: {
          symbol: asset.symbol,
          address: asset.address,
          decimals: asset.decimals,
          chain: "Ethereum",
          collateral: data[8],
        },
      });
    }

    if (debt > 0) {
      rows.push({
        id: `${account.id}:aave:${asset.symbol}:debt`,
        accountId: account.id,
        accountLabel: account.label,
        source: "aave",
        symbol: asset.symbol,
        name: `${asset.symbol} borrowed on Aave`,
        kind: "debt",
        quantity: debt,
        valueUsd: 0,
        debtUsd: roundCurrency(debt * priceUsd),
        details: {
          symbol: asset.symbol,
          address: asset.address,
          decimals: asset.decimals,
          chain: "Ethereum",
          variableDebt,
          stableDebt,
        },
      });
    }

    return rows;
  });

  const totalCollateralUsd = Number(accountData[0]) / Number(baseCurrencyUnit);
  const totalDebtUsd = Number(accountData[1]) / Number(baseCurrencyUnit);
  const healthFactorRaw = Number(accountData[5]);
  const healthFactor =
    healthFactorRaw > 1e25 ? null : Number(formatUnits(accountData[5], 18));

  return {
    summary: {
      source: "aave",
      label: account.label,
      netWorthUsd: roundCurrency(totalCollateralUsd - totalDebtUsd),
      totalInvestmentsUsd: roundCurrency(totalCollateralUsd),
      totalDebtUsd: roundCurrency(totalDebtUsd),
      healthFactor,
      positionCount: positions.length,
    },
    positions,
  };
}

export function extractAaveReserveHints(positions: PortfolioPosition[]) {
  return positions
    .filter((position) => position.source === "aave")
    .map((position) => position.details)
    .filter((details): details is NonNullable<typeof details> => Boolean(details))
    .map((details) => ({
      symbol: String(details.symbol),
      address: String(details.address),
      decimals: Number(details.decimals),
    }))
    .filter((hint) => hint.address.startsWith("0x") && hint.decimals >= 0)
    .reduce<AaveReserveHint[]>((hints, hint) => {
      if (!hints.some((existing) => existing.address === hint.address)) {
        hints.push(hint);
      }

      return hints;
    }, []);
}

export function getAaveAssets(): AaveAsset[] {
  return Object.entries(AaveV3Ethereum.ASSETS).map(([symbol, asset]) => ({
    symbol,
    address: asset.UNDERLYING as Address,
    decimals: asset.decimals,
  }));
}
