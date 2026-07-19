import { AppShell } from "@/components/app-shell";
import { PortfolioDashboard } from "@/components/portfolio-dashboard";

export default function Home() {
  return (
    <AppShell>
      <PortfolioDashboard />
    </AppShell>
  );
}
