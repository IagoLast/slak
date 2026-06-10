import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return <AppShell currentUser={user}>{children}</AppShell>;
}
