import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/db";
import {
  agents,
  agentTasks,
  channelMembers,
  machineCommands,
  machines,
  messages,
  users,
} from "@/db/schema";
import {
  agentInbox,
  authenticateAgent,
  claimTask,
  finishTask,
  hashToken,
} from "@/lib/agents";

export const runtime = "nodejs";
const output = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
const idSchema = z.string().min(1).max(100);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return new Response("Origin no permitido", { status: 403 });
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (slak_[a-f0-9]{64})$/)?.[1];
  if (!bearer)
    return new Response("Token requerido", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  const agent = await authenticateAgent(request);
  const machine = agent
    ? null
    : await db.query.machines.findFirst({
        where: eq(machines.tokenHash, hashToken(bearer)),
      });
  if (!agent && !machine)
    return new Response("Token revocado o no válido", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });

  const server = new McpServer({ name: "slak", version: "1.0.0" });
  // The authenticated identity always determines scope; callers cannot impersonate another agent.
  async function taskOwner(taskId: string) {
    const task = await db.query.agentTasks.findFirst({
      where: eq(agentTasks.id, taskId),
    });
    if (!task) throw new Error("Tarea no encontrada.");
    const owner = await db.query.agents.findFirst({
      where: eq(agents.id, task.agentId),
    });
    if (
      !owner ||
      (agent ? owner.id !== agent.id : owner.machineId !== machine!.id)
    )
      throw new Error("Tarea no autorizada.");
    return { task, owner };
  }

  server.registerTool(
    "heartbeat",
    {
      description:
        "Mantiene la presencia online. Las máquinas anuncian únicamente los proyectos que su propietario comparte.",
      inputSchema: {
        repositories: z
          .array(
            z.object({
              id: z.string().min(1).max(500),
              name: z.string().min(1).max(100),
            }),
          )
          .max(100)
          .optional(),
        sessions: z
          .array(
            z.object({
              worktree: z.string().min(1).max(1000),
              name: z.string().max(100),
              repository: z.string().max(500),
              provider: z.enum(["codex", "claude"]),
              runtimeHandle: z.string().startsWith("term_").max(200),
            }),
          )
          .max(200)
          .optional(),
      },
    },
    async ({ repositories, sessions }) => {
      if (machine)
        await db
          .update(machines)
          .set({
            lastSeenAt: new Date(),
            ...(repositories && { repositories }),
            ...(sessions && { sessions }),
          })
          .where(eq(machines.id, machine.id));
      else
        await db
          .update(agents)
          .set({ lastSeenAt: new Date() })
          .where(eq(agents.id, agent!.id));
      return output({
        id: machine?.id ?? agent!.id,
        kind: machine ? "machine" : "agent",
      });
    },
  );
  server.registerTool(
    "list_tasks",
    {
      description:
        "Bandeja persistente de mensajes y tareas, incluidas las que siguen en curso.",
      inputSchema: {},
    },
    async () => {
      if (agent) return output({ tasks: await agentInbox(agent.id) });
      const rows = await db
        .select({
          task: agentTasks,
          worktree: agents.worktree,
          repository: agents.repository,
          runtimeHandle: agents.runtimeHandle,
        })
        .from(agentTasks)
        .innerJoin(agents, eq(agents.id, agentTasks.agentId))
        .where(
          and(
            eq(agents.machineId, machine!.id),
            eq(agents.state, "ready"),
            inArray(agentTasks.status, ["queued", "running"]),
          ),
        )
        .orderBy(asc(agentTasks.createdAt))
        .limit(100);
      return output({
        tasks: rows.map(({ task, ...runtime }) => ({ ...task, ...runtime })),
      });
    },
  );
  server.registerTool(
    "claim_task",
    {
      description:
        "Recoge una tarea pendiente de forma atómica. Solo una en curso por agente.",
      inputSchema: { taskId: idSchema },
    },
    async ({ taskId }) => {
      const { owner } = await taskOwner(taskId);
      if (owner.machineId && owner.state !== "ready")
        throw new Error("El agente no está listo.");
      return output(await claimTask(owner.id, taskId));
    },
  );
  server.registerTool(
    "task_context",
    {
      description:
        "Lee el mensaje original y el hilo o los últimos mensajes del canal asignado.",
      inputSchema: { taskId: idSchema },
    },
    async ({ taskId }) => {
      const { task, owner } = await taskOwner(taskId);
      const membership = await db.query.channelMembers.findFirst({
        where: and(
          eq(channelMembers.channelId, task.channelId),
          eq(channelMembers.userId, owner.id),
        ),
      });
      if (!membership)
        throw new Error("El agente ya no tiene acceso al canal.");
      const source = await db.query.messages.findFirst({
        where: eq(messages.id, task.messageId),
      });
      const rootId = source?.parentId;
      const rows = await db
        .select({
          id: messages.id,
          content: messages.content,
          parentId: messages.parentId,
          author: users.name,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.userId))
        .where(
          and(
            eq(messages.channelId, task.channelId),
            rootId
              ? or(eq(messages.id, rootId), eq(messages.parentId, rootId))
              : isNull(messages.parentId),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(40);
      return output({ task, messages: rows.reverse() });
    },
  );
  server.registerTool(
    "reply_task",
    {
      description:
        "Publica una actualización en la conversación de una tarea en curso sin completarla.",
      inputSchema: {
        taskId: idSchema,
        content: z.string().trim().min(1).max(16000),
      },
    },
    async ({ taskId, content }) => {
      const { task, owner } = await taskOwner(taskId);
      if (task.status !== "running")
        throw new Error("La tarea no está en curso.");
      const source = await db.query.messages.findFirst({
        where: eq(messages.id, task.messageId),
      });
      const id = nanoid();
      await db
        .insert(messages)
        .values({
          id,
          channelId: task.channelId,
          userId: owner.id,
          parentId: source!.parentId ?? source!.id,
          content,
        });
      return output({ id });
    },
  );
  server.registerTool(
    "finish_task",
    {
      description:
        "Completa o marca fallida una tarea en curso y publica el resultado con la identidad del agente.",
      inputSchema: {
        taskId: idSchema,
        status: z.enum(["completed", "failed"]),
        result: z.string().trim().min(1).max(16000),
      },
    },
    async ({ taskId, status, result }) => {
      const { owner } = await taskOwner(taskId);
      return output(await finishTask(owner.id, taskId, status, result));
    },
  );

  if (machine) {
    server.registerTool(
      "list_commands",
      {
        description:
          "Órdenes de crear, arrancar o detener worktrees de esta máquina.",
        inputSchema: {},
      },
      async () => {
        const commands = await db
          .select({
            command: machineCommands,
            agent: {
              id: agents.id,
              name: users.name,
              handle: agents.handle,
              repository: agents.repository,
              provider: agents.provider,
              worktree: agents.worktree,
              runtimeHandle: agents.runtimeHandle,
            },
          })
          .from(machineCommands)
          .innerJoin(agents, eq(agents.id, machineCommands.agentId))
          .innerJoin(users, eq(users.id, agents.id))
          .where(
            and(
              eq(machineCommands.machineId, machine.id),
              inArray(machineCommands.status, ["queued", "running"]),
            ),
          )
          .orderBy(asc(machineCommands.createdAt))
          .limit(100);
        return output({ commands });
      },
    );
    server.registerTool(
      "claim_command",
      {
        description:
          "Reserva una orden una sola vez; una respuesta ambigua nunca debe volver a ejecutarse automáticamente.",
        inputSchema: { commandId: idSchema },
      },
      async ({ commandId }) => {
        const [command] = await db
          .update(machineCommands)
          .set({ status: "running" })
          .where(
            and(
              eq(machineCommands.id, commandId),
              eq(machineCommands.machineId, machine.id),
              eq(machineCommands.status, "queued"),
            ),
          )
          .returning();
        if (!command) throw new Error("Orden ya recogida o no autorizada.");
        return output(command);
      },
    );
    server.registerTool(
      "report_command",
      {
        description:
          "Confirma la ejecución real en Orca, incluyendo worktree y terminal persistente; o informa de un fallo.",
        inputSchema: {
          commandId: idSchema,
          success: z.boolean(),
          worktree: z.string().max(1000).optional(),
          runtimeHandle: z.string().max(200).optional(),
          error: z.string().max(2000).optional(),
        },
      },
      async ({ commandId, success, worktree, runtimeHandle, error }) => {
        await db.transaction(async (tx) => {
          const [command] = await tx
            .select()
            .from(machineCommands)
            .where(
              and(
                eq(machineCommands.id, commandId),
                eq(machineCommands.machineId, machine.id),
              ),
            )
            .for("update");
          if (!command || command.status !== "running")
            throw new Error("Orden no disponible.");
          if (
            success &&
            command.action !== "stop" &&
            (!worktree || !runtimeHandle?.startsWith("term_"))
          )
            throw new Error("Falta el worktree o el terminal del agente.");
          await tx
            .update(machineCommands)
            .set({ status: success ? "completed" : "failed" })
            .where(eq(machineCommands.id, commandId));
          await tx
            .update(agents)
            .set({
              state: success
                ? command.action === "stop"
                  ? "stopped"
                  : "ready"
                : "error",
              error: success
                ? null
                : (error ?? "No se pudo ejecutar la orden en Orca."),
              ...(worktree && { worktree }),
              ...(runtimeHandle && { runtimeHandle }),
              ...(success &&
                command.action === "stop" && { runtimeHandle: null }),
            })
            .where(eq(agents.id, command.agentId));
          if (success && command.action === "stop")
            await tx
              .update(agentTasks)
              .set({
                status: "failed",
                result: "Agente detenido por el equipo.",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(agentTasks.agentId, command.agentId),
                  inArray(agentTasks.status, ["queued", "running"]),
                ),
              );
        });
        return output({ ok: true });
      },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    // Consume before closing so no response stream is abandoned by the transport.
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers,
    });
  } finally {
    await server.close();
  }
}
export async function GET() {
  return new Response("Usa POST con Streamable HTTP", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
