"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { JournalNewsResponse } from "@/lib/types";

type JournalNewsState = {
  error: string;
  loading: boolean;
  news: JournalNewsResponse | null;
  refreshNews: () => Promise<JournalNewsResponse>;
  setNews: Dispatch<SetStateAction<JournalNewsResponse | null>>;
  tradeId: string;
};

const JournalNewsContext = createContext<JournalNewsState | null>(null);

export function JournalNewsProvider({
  children,
  tradeId,
}: {
  children: ReactNode;
  tradeId: string;
}) {
  const state = useJournalNewsState(tradeId, true);
  return (
    <JournalNewsContext.Provider value={state}>
      {children}
    </JournalNewsContext.Provider>
  );
}

export function useJournalNews(tradeId: string) {
  const sharedState = useContext(JournalNewsContext);
  const localState = useJournalNewsState(tradeId, sharedState === null);

  if (sharedState && sharedState.tradeId !== tradeId) {
    throw new Error("Journal news was requested for the wrong journal.");
  }
  return sharedState ?? localState;
}

function useJournalNewsState(
  tradeId: string,
  enabled: boolean,
): JournalNewsState {
  const [news, setNews] = useState<JournalNewsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);

  const requestNews = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(`/api/journal/trades/${tradeId}/news`, {
        signal,
      });
      const payload = (await response.json()) as {
        error?: string;
        news?: JournalNewsResponse;
      };
      if (!response.ok || !payload.news) {
        throw new Error(payload.error || "Unable to load news.");
      }
      return payload.news;
    },
    [tradeId],
  );

  const refreshNews = useCallback(async () => {
    setError("");
    try {
      const nextNews = await requestNews();
      setNews(nextNews);
      return nextNews;
    } catch (refreshError) {
      const message = toErrorMessage(refreshError, "Unable to refresh news.");
      setError(message);
      throw new Error(message);
    }
  }, [requestNews]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    void requestNews(controller.signal)
      .then(setNews)
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(toErrorMessage(loadError, "Unable to load news."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [enabled, requestNews]);

  return useMemo(
    () => ({ error, loading, news, refreshNews, setNews, tradeId }),
    [error, loading, news, refreshNews, tradeId],
  );
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
