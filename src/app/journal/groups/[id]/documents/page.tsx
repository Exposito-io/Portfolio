import { AppShell } from "@/components/app-shell";
import { JournalGroupDetail } from "@/components/journal-group-detail";

export default async function GroupDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell><JournalGroupDetail groupId={id} initialTab="documents" initialDocumentId={null} /></AppShell>;
}
