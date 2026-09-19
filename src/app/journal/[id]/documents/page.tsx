import { AppShell } from "@/components/app-shell";
import { JournalDetail } from "@/components/journal-detail";

type JournalDocumentsPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function JournalDocumentsPage({
  params,
}: JournalDocumentsPageProps) {
  const { id } = await params;

  return (
    <AppShell>
      <JournalDetail initialTab="documents" tradeId={id} />
    </AppShell>
  );
}
