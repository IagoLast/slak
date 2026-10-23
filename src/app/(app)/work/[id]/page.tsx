import WorkConversation from "@/components/WorkConversation";
export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const [{ id }, { session }] = await Promise.all([params, searchParams]);
  return (
    <WorkConversation
      key={`${id}:${session || "parent"}`}
      threadId={id}
      sessionId={session}
    />
  );
}
