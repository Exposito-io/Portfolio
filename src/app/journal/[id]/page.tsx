import { AppShell } from "@/components/app-shell";
import { JournalDetail } from "@/components/journal-detail";

type JournalTradePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function JournalTradePage({
  params,
}: JournalTradePageProps) {
  const { id } = await params;

  return (
    <AppShell>
      <JournalDetail tradeId={id} />
    </AppShell>
  );
}
