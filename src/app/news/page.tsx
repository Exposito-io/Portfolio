import { AppShell } from "@/components/app-shell";
import { OpenJournalNewsReader } from "@/components/open-journal-news-reader";

export default function NewsPage() {
  return (
    <AppShell>
      <OpenJournalNewsReader />
    </AppShell>
  );
}
