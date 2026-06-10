import { asc, eq, inArray, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { channelMembers, channels } from "@/db/schema";
import { requireUser } from "@/lib/session";

export default async function HomePage() {
  const user = await requireUser();

  const memberships = await db
    .select({ channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(eq(channelMembers.userId, user.id));
  const memberIds = memberships.map((m) => m.channelId);

  const [first] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(
      user.role === "guest"
        ? memberIds.length > 0
          ? inArray(channels.id, memberIds)
          : eq(channels.id, "__none__")
        : memberIds.length > 0
          ? or(eq(channels.type, "public"), inArray(channels.id, memberIds))
          : eq(channels.type, "public"),
    )
    .orderBy(asc(channels.createdAt))
    .limit(1);

  if (first) redirect(`/c/${first.id}`);

  return (
    <div className="flex flex-1 items-center justify-center text-gray-500">
      <p>Todavía no tienes acceso a ningún canal.</p>
    </div>
  );
}
