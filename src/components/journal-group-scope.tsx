import Link from "next/link";
import { Layers3 } from "lucide-react";

import type { JournalTradeGroup } from "@/lib/types";

export function JournalGroupScope({
  activeTradeId,
  group,
}: {
  activeTradeId: string | null;
  group: JournalTradeGroup;
}) {
  return (
    <nav aria-label="Journal positions" className="journal-group-scope">
      {activeTradeId === null ? (
        <span aria-current="page" className="active">
          <Layers3 size={15} />All
        </span>
      ) : (
        <Link href={`/journal/groups/${group.id}`}>
          <Layers3 size={15} />All
        </Link>
      )}
      {group.members.map((member) =>
        member.id === activeTradeId ? (
          <span aria-current="page" className="active" key={member.id}>
            {member.asset.coin}
            <small>{member.endDate ? "Closed" : "Open"}</small>
          </span>
        ) : (
          <Link href={`/journal/${member.id}`} key={member.id}>
            {member.asset.coin}
            <small>{member.endDate ? "Closed" : "Open"}</small>
          </Link>
        ),
      )}
    </nav>
  );
}
