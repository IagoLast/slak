import Sidebar from "@/components/Sidebar";
import { requireUser } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex h-full">
      <Sidebar currentUser={user} />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
