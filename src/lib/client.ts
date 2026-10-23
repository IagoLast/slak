import type { SharedWorktree } from "@/lib/workspaces";

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
  canDelete: boolean;
  unread: number;
  dmUserId?: string;
  lastMessage: { author: string; preview: string } | null;
};

export type SummaryUser = {
  id: string;
  name: string;
  role: "admin" | "member" | "guest";
  online: boolean;
  kind: "human" | "agent";
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
  workThreadId?: string | null;
  user: { id: string; name: string; kind?: "human" | "agent" };
};

export type WorkThreadSummary = {
  id: string;
  title: string;
  channelId: string;
  rootMessageId: string;
  worktree: string | null;
  sessionId: string;
  closedAt: string | null;
  handle: string;
  machine: string | null;
  machineId: string | null;
  repository: string;
  online: boolean;
  workers: {
    id: string;
    name: string;
    worktree: string | null;
    closedAt: string | null;
    state: WorkThreadSummary["state"];
  }[];
  state: "idle" | "running" | "waiting" | "stopped" | "error";
  createdAt: string;
};
export type WorkSession = {
  id: string;
  name: string;
  role: "orchestrator" | "worker";
  parentId: string | null;
  worktree: string | null;
  closedAt: string | null;
  state: WorkThreadSummary["state"];
  memory: string;
  memoryVersion: number;
  generation: number;
  runtimeId: string | null;
  context: { tokens?: number; window?: number; compactedAt?: string };
  error: string | null;
  lastSeenAt: string | null;
};
export type WorkEvent = {
  sessionId: string;
  itemId: string;
  revision: number;
  sequence: number;
  observedAt: string;
  body: Record<string, unknown>;
};
export type WorkTurn = {
  id: string;
  prompt: string;
  result: string | null;
  kind: "human" | "delegation" | "notification";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  author: string;
};
export type WorkConversationData = {
  workspace: { name: string; branch: string } | null;
  thread: {
    id: string;
    title: string;
    objective: string;
    worktree: string | null;
    channelId: string;
    rootMessageId: string;
  };
  sessions: WorkSession[];
  selectedId: string;
  events: WorkEvent[];
  turns: WorkTurn[];
  actions: { id: string; kind: string; status: string; error: string | null }[];
  bot: {
    mode: "session" | "orchestrator";
    handle: string;
    name: string;
    machine: string;
    state: string;
    lastSeenAt: string | null;
    online: boolean;
    enabled: boolean;
  };
  canSend: boolean;
  canManage: boolean;
  canInterrupt: boolean;
  canCloseWorktree: boolean;
  hasOlder: boolean;
  next: { events: string | null; turns: string | null };
};

export type SharedMachine = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  online: boolean;
  enabled: boolean;
  lastSeenAt: string | null;
  worktrees: SharedWorktree[];
  repositories: { id: string; name: string }[];
  sessions: {
    worktree: string;
    name: string;
    repository: string;
    provider: "codex" | "claude";
    runtimeHandle: string;
  }[];
};

export async function api<T = Record<string, never>>(
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.error ?? "No se pudo completar la operación.");
  return data;
}

export type WorktreeChats = {
  name: string;
  machine: string;
  online: boolean;
  canOpen: boolean;
  sessions: {
    id: string;
    threadId: string | null;
    sessionId: string | null;
    runtimeId: string | null;
    name: string;
    state: WorkSession["state"];
  }[];
};
