"use client";

import { useEffect, useState } from "react";

import type {
  HyperliquidFilledOrder,
  JournalTradePnlSummary,
  SourceError,
} from "@/lib/types";

type FilledOrdersResponse = {
  orders: HyperliquidFilledOrder[];
  summary: JournalTradePnlSummary;
  sourceErrors: SourceError[];
  accountsCount: number;
  timezone: string;
};

export type FilledOrdersState = {
  data: FilledOrdersResponse | null;
  error: string;
  loading: boolean;
};

export function useJournalFilledOrders(tradeId: string | null): FilledOrdersState {
  const [data, setData] = useState<FilledOrdersResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(tradeId));

  useEffect(() => {
    if (!tradeId) {
      return;
    }

    const controller = new AbortController();

    async function loadOrders() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/journal/trades/${tradeId}/filled-orders`,
          {
            signal: controller.signal,
          },
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load orders.");
        setData(payload);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load orders.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadOrders();
    return () => controller.abort();
  }, [tradeId]);

  return tradeId ? { data, error, loading } : { data: null, error: "", loading: false };
}
