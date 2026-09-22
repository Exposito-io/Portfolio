import { AppShell } from "@/components/app-shell";
import { JournalGroupDetail } from "@/components/journal-group-detail";

type JournalGroupPageProps = { params: Promise<{ id: string }> };

export default async function JournalGroupPage({ params }: JournalGroupPageProps) {
  const { id } = await params;
  return (
    <AppShell>
      <JournalGroupDetail groupId={id} />
    </AppShell>
  );
}
