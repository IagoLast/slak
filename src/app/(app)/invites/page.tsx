import { redirect } from "next/navigation";
import InviteManager from "@/components/InviteManager";
import { requireUser } from "@/lib/session";

export default async function InvitesPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");

  return <InviteManager />;
}
