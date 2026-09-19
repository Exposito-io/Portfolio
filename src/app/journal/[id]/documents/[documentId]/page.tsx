import { AppShell } from "@/components/app-shell";
import { JournalDetail } from "@/components/journal-detail";

type JournalDocumentPageProps = {
  params: Promise<{
    id: string;
    documentId: string;
  }>;
};

export default async function JournalDocumentPage({
  params,
}: JournalDocumentPageProps) {
  const { id, documentId } = await params;

  return (
    <AppShell>
      <JournalDetail
        initialDocumentId={documentId}
        initialTab="documents"
        tradeId={id}
      />
    </AppShell>
  );
}
