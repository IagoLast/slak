export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
};

export type SummaryChannel = {
  id: string;
  name: string;
  type: "public" | "private" | "dm";
  unread: number;
  dmUserId?: string;
};

export type SummaryUser = {
  id: string;
  name: string;
  role: "admin" | "member" | "guest";
};

export type Summary = {
  user: { id: string; name: string; email: string; role: string };
  channels: SummaryChannel[];
  users: SummaryUser[];
};

export type ChatMessage = {
  id: string;
  content: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: "file" | "image" | "audio" | null;
  createdAt: string;
  replyCount?: number;
  user: { id: string; name: string };
};
