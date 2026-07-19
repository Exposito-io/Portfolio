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
): Promise<AaveAccountResult> {
  const user = account.address as Address;
  const [
    accountData,
    baseCurrencyUnit,
    reserveData,
    prices,
  ] = await Promise.all([
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
    Promise.all(
      getAaveAssets().map((asset) =>
        client.readContract({
          address: AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER as Address,
          abi: protocolDataProviderAbi,
          functionName: "getUserReserveData",
          args: [asset.address, user],
        }),
      ),
    ),
    Promise.all(
      getAaveAssets().map((asset) =>
        client.readContract({
          address: AaveV3Ethereum.ORACLE as Address,
          abi: oracleAbi,
          functionName: "getAssetPrice",
          args: [asset.address],
        }),
      ),
    ),
  ]);

  const assets = getAaveAssets();
  const positions = reserveData.flatMap((data, index) => {
    const asset = assets[index];
    const priceUsd = Number(prices[index]) / Number(baseCurrencyUnit);
    const supplied = Number(formatUnits(data[0], asset.decimals));
    const stableDebt = Number(formatUnits(data[1], asset.decimals));
    const variableDebt = Number(formatUnits(data[2], asset.decimals));
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

function getAaveAssets(): AaveAsset[] {
  return Object.entries(AaveV3Ethereum.ASSETS).map(([symbol, asset]) => ({
    symbol,
    address: asset.UNDERLYING as Address,
    decimals: asset.decimals,
  }));
}
