import { AppShell } from "@/components/app-shell";
import { JournalGroupDetail } from "@/components/journal-group-detail";

export default async function GroupDocumentPage({ params }: { params: Promise<{ id: string; documentId: string }> }) {
  const { id, documentId } = await params;
  return <AppShell><JournalGroupDetail groupId={id} initialTab="documents" initialDocumentId={documentId} /></AppShell>;
}
