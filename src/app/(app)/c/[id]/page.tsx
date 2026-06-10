import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import ChatRoom from "@/components/ChatRoom";
import { db } from "@/db";
import { channelMembers, users } from "@/db/schema";
import { getAccessibleChannel } from "@/lib/channels";
import { requireUser } from "@/lib/session";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const channel = await getAccessibleChannel(user, id);
  if (!channel) redirect("/");

  let title = channel.name;
  if (channel.type === "dm") {
    const [partner] = await db
      .select({ name: users.name })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(
        and(eq(channelMembers.channelId, id), ne(channelMembers.userId, user.id)),
      )
      .limit(1);
    title = partner?.name ?? "Mensaje directo";
  }

  return (
    <ChatRoom
      key={channel.id}
      channelId={channel.id}
      channelName={title}
      channelType={channel.type}
      channelDescription={channel.description}
      currentUser={user}
    />
  );
}
