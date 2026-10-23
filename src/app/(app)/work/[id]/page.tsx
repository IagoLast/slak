import WorkConversation from "@/components/WorkConversation";
export default async function WorkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <WorkConversation key={(await params).id} threadId={(await params).id} />
  );
}
