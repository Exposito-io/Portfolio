"use client";

import { useEffect, useMemo, useState } from "react";

import type { FilledOrdersResponse, FilledOrdersState } from "@/components/use-journal-filled-orders";
import { aggregateJournalTradePnlSummaries } from "@/lib/journal-pnl";
import type { JournalTrade } from "@/lib/types";

export type JournalGroupOrdersState = {
  byTradeId: Record<string, FilledOrdersState>;
  summary: ReturnType<typeof aggregateJournalTradePnlSummaries>;
  loading: boolean;
  error: string;
};

export function useJournalGroupOrders(members: JournalTrade[]): JournalGroupOrdersState {
  const memberKey = members.map((member) => member.id).join(":");
  const [byTradeId, setByTradeId] = useState<Record<string, FilledOrdersState>>({});

  useEffect(() => {
    const tradeMembers = members.filter((member) => member.kind === "trade");
    if (!tradeMembers.length) {
      setByTradeId({});
      return;
    }
    const controller = new AbortController();
    setByTradeId(Object.fromEntries(tradeMembers.map((member) => [
      member.id,
      { data: null, error: "", loading: true },
    ])));

    void Promise.all(tradeMembers.map(async (member) => {
      try {
        const response = await fetch(`/api/journal/trades/${member.id}/filled-orders`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load orders.");
        setByTradeId((current) => ({
          ...current,
          [member.id]: { data: payload as FilledOrdersResponse, error: "", loading: false },
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setByTradeId((current) => ({
          ...current,
          [member.id]: {
            data: null,
            error: error instanceof Error ? error.message : "Unable to load orders.",
            loading: false,
          },
        }));
      }
    }));

    return () => controller.abort();
  // memberKey is the stable primitive dependency for the member set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey]);

  return useMemo(() => {
    const states = members.map((member) => byTradeId[member.id]).filter(Boolean);
    return {
      byTradeId,
      summary: aggregateJournalTradePnlSummaries(states.map((state) => state.data?.summary)),
      loading: states.length === 0 ? members.some((member) => member.kind === "trade") : states.some((state) => state.loading),
      error: states.map((state) => state.error).filter(Boolean).join(" "),
    };
  }, [byTradeId, members]);
}
