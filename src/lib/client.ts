export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
};

export type SummaryChannel = {
  id: string;
  name: string;
  type: "public" | "private" | "dm";
  description: string | null;
  unread: number;
  dmUserId?: string;
  lastMessage: { author: string; preview: string } | null;
};

export type SummaryUser = {
  id: string;
  name: string;
  role: "admin" | "member" | "guest";
  online: boolean;
};

export type Summary = {
  user: {
    id: string;
    name: string;
    email: string;
    role: "admin" | "member" | "guest";
  };
  channels: SummaryChannel[];
  users: SummaryUser[];
};

export type MessagePayload = {
  content?: string | null;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: "file" | "image" | "audio";
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
