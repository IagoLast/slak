import { sql } from "drizzle-orm";
import type { SharedWorktree } from "@/lib/workspaces";
import {
  boolean,
  index,
  uniqueIndex,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["human", "agent"] })
    .notNull()
    .default("human"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member", "guest"] })
    .notNull()
    .default("member"),
  // Latido de presencia: se actualiza con cada poll del resumen.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const channels = pgTable("channels", {
  isWorktree: boolean("is_worktree").notNull().default(false),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type", { enum: ["public", "private", "dm"] })
    .notNull()
    .default("public"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const channelMembers = pgTable(
  "channel_members",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index("channel_members_user_idx").on(t.userId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Si apunta a otro mensaje, este mensaje es una respuesta de su hilo.
    parentId: text("parent_id"),
    content: text("content"),
    attachmentUrl: text("attachment_url"),
    attachmentName: text("attachment_name"),
    attachmentType: text("attachment_type", {
      enum: ["file", "image", "audio"],
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("messages_channel_created_idx").on(t.channelId, t.createdAt),
    index("messages_parent_idx").on(t.parentId),
  ],
);

export const invites = pgTable("invites", {
  token: text("token").primaryKey(),
  email: text("email"),
  role: text("role", { enum: ["member", "guest"] })
    .notNull()
    .default("member"),
  channelIds: jsonb("channel_ids").$type<string[]>().notNull().default([]),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// Participantes activos de un huddle (llamada de audio) por canal.
// Un participante se considera caído si last_seen_at queda obsoleto.
export const huddleParticipants = pgTable(
  "huddle_participants",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] })],
);

// Señalización WebRTC (ofertas, respuestas y candidatos ICE) entre pares.
// Los mensajes se borran al ser entregados.
export const huddleSignals = pgTable("huddle_signals", {
  id: text("id").primaryKey(),
  channelId: text("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  fromUserId: text("from_user_id").notNull(),
  toUserId: text("to_user_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Invite = typeof invites.$inferSelect;

export const agents = pgTable(
  "agents",
  {
    id: text("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    handle: text("handle").notNull().unique(),
    mode: text("mode", { enum: ["session", "orchestrator"] })
      .notNull()
      .default("session"),
    description: text("description").notNull().default(""),
    machine: text("machine").notNull().default(""),
    machineId: text("machine_id").references(() => machines.id),
    worktree: text("worktree").notNull().default(""),
    repository: text("repository").notNull().default(""),
    provider: text("provider", { enum: ["codex", "claude"] })
      .notNull()
      .default("codex"),
    runtimeHandle: text("runtime_handle"),
    state: text("state", {
      enum: ["external", "starting", "ready", "stopping", "stopped", "error"],
    })
      .notNull()
      .default("external"),
    error: text("error"),
    tokenHash: text("token_hash").unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_machine_worktree")
      .on(t.machineId, t.worktree)
      .where(sql`${t.worktree} <> '' AND ${t.machineId} IS NOT NULL`),
  ],
);

export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["task", "message"] })
      .notNull()
      .default("task"),
    prompt: text("prompt").notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    })
      .notNull()
      .default("queued"),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("agent_tasks_inbox_idx").on(t.agentId, t.status, t.createdAt),
    uniqueIndex("agent_one_running_task")
      .on(t.agentId)
      .where(sql`${t.status} = 'running'`),
  ],
);

export type Agent = typeof agents.$inferSelect;

export const machines = pgTable("machines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").unique(),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  repositories: jsonb("repositories")
    .$type<{ id: string; name: string }[]>()
    .notNull()
    .default([]),
  worktrees: jsonb("worktrees").$type<SharedWorktree[]>().notNull().default([]),
  sessions: jsonb("sessions")
    .$type<
      {
        worktree: string;
        name: string;
        repository: string;
        provider: "codex" | "claude";
        runtimeHandle: string;
      }[]
    >()
    .notNull()
    .default([]),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const machinePairings = pgTable("machine_pairings", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  machineId: text("machine_id").references(() => machines.id, {
    onDelete: "cascade",
  }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

export const machineCommands = pgTable("machine_commands", {
  id: text("id").primaryKey(),
  machineId: text("machine_id")
    .notNull()
    .references(() => machines.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  action: text("action", { enum: ["create", "start", "stop"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "completed", "failed"] })
    .notNull()
    .default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A bot is an identity. A work thread owns its workspace and durable conversation;
// sessions are replaceable runtimes, never the identity or the source of truth.
export const workThreads = pgTable(
  "work_threads",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    rootMessageId: text("root_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    repository: text("repository").notNull(),
    worktree: text("worktree"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("work_thread_root_bot").on(t.rootMessageId, t.agentId)],
);

export const workSessions = pgTable(
  "work_sessions",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => workThreads.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    role: text("role", { enum: ["orchestrator", "worker"] }).notNull(),
    state: text("state", {
      enum: ["idle", "running", "waiting", "stopped", "error"],
    })
      .notNull()
      .default("idle"),
    runtimeId: text("runtime_id"),
    worktree: text("worktree"),
    generation: integer("generation").notNull().default(1),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    imported: boolean("imported").notNull().default(false),
    provider: text("provider", { enum: ["codex", "claude"] }),
    memory: text("memory").notNull().default(""),
    memoryVersion: integer("memory_version").notNull().default(0),
    context: jsonb("context")
      .$type<{ tokens?: number; window?: number; compactedAt?: string }>()
      .notNull()
      .default({}),
    tokenHash: text("token_hash").unique(),
    error: text("error"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("work_thread_coordinator")
      .on(t.threadId)
      .where(sql`${t.role} = 'orchestrator'`),
  ],
);

export const workTurns = pgTable(
  "work_turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    prompt: text("prompt").notNull(),
    kind: text("kind", { enum: ["human", "delegation", "notification"] })
      .notNull()
      .default("human"),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("work_session_running_turn")
      .on(t.sessionId)
      .where(sql`${t.status} = 'running'`),
    index("work_session_queue").on(t.sessionId, t.createdAt),
    uniqueIndex("work_message_delivery").on(t.sessionId, t.messageId),
  ],
);

export const workEvents = pgTable(
  "work_events",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    revision: integer("revision").notNull(),
    sequence: integer("sequence").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.itemId] }),
    index("work_events_time").on(t.sessionId, t.observedAt),
  ],
);

export const workActions = pgTable(
  "work_actions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => workSessions.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "workspace",
        "stop",
        "interrupt",
        "compact",
        "rotate",
        "respond",
        "close-worktree",
      ],
    }).notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    })
      .notNull()
      .default("queued"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("work_actions_pending").on(t.sessionId, t.status)],
);
