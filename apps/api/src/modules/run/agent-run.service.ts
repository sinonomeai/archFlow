import { createHash, randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  HttpException,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  AgentStateEntity,
  ConversationEntity,
  KnowledgeFileEntity,
  MessageEntity,
  ProjectEntity,
  RunEntity,
} from "@arch-flow/db";
import { AgentExecutionError, type createAgentEngine } from "@arch-flow/agent";
import {
  AGENT_HISTORY_LIMIT,
  AgentTurn,
  AgentTurnResult,
  ERROR_CODES,
  GraphInput,
  Interrupt,
  MessageMetadata,
  SendMessageInput,
  type AgentResume,
  type Run as RunResult,
} from "@arch-flow/shared";
import { type EntityManager, In } from "typeorm";
import { DatabaseService } from "../../database/database.service.js";
import {
  RUN_ACTIVE_STATUSES,
  RunMetadata,
  getOwnedConversation,
  getRunMessages,
  resourceId,
  runException,
  snapshotRun,
} from "./run-store.js";

export const RUN_ENGINE = Symbol("RUN_ENGINE");
export type RunEngine = ReturnType<typeof createAgentEngine>;

const RUN_TIMEOUT_MS = 90_000;
const LEASE_TIMEOUT_MS = RUN_TIMEOUT_MS + 30_000;
const INTERRUPT_TIMEOUT_MS = 24 * 60 * 60_000;
const EXTRAS_TIMEOUT_MS = 25_000;
const DEFAULT_TITLE = "新会话";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hasExpired = (expiresAt?: string) =>
  !!expiresAt && Date.parse(expiresAt) <= Date.now();
const notResumable = () =>
  runException(
    409,
    ERROR_CODES.RUN_NOT_RESUMABLE,
    "运行正在执行或已结束，无法继续这个中断",
  );

type ClaimedRun = {
  turn: AgentTurn;
  resume?: AgentResume;
  token: string;
  stateVersion: number;
};

@Injectable()
export class AgentRunService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentRunService.name);
  private readonly running = new Map<string, AbortController>();

  constructor(
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, "dataSource">,
    @Inject(RUN_ENGINE) private readonly engine: RunEngine | null,
  ) {}

  /** A future HTTP adapter passes the owner ID from its authenticated principal. */
  accept = async (
    ownerId: string,
    conversationId: string,
    body: SendMessageInput,
    idempotencyKey: string,
  ): Promise<RunResult> => {
    const input = SendMessageInput.parse(body);
    if (input.graphReferenceMessageId)
      throw runException(
        400,
        ERROR_CODES.BAD_REQUEST,
        "历史图提问请从本地工作台发起。",
      );
    const key = resourceId(idempotencyKey);
    const scopedOwner = resourceId(ownerId);
    const scope = { conversationId: resourceId(conversationId) };
    const attachments = [...new Set((input.attachments ?? []).map(resourceId))];
    const hash = digest({ content: input.content, attachments });

    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(
        manager,
        scopedOwner,
        scope,
      );
      const runs = manager.getRepository(RunEntity);
      const replay = await runs
        .createQueryBuilder("run")
        .where("run.conversation_id = :conversationId", {
          conversationId: conversation.id,
        })
        .andWhere("(run.metadata -> 'receipts') @> CAST(:receipt AS jsonb)", {
          receipt: JSON.stringify([{ key }]),
        })
        .getOne();

      if (replay) {
        const metadata = RunMetadata.parse(replay.metadata);
        if (
          metadata.receipts.find((receipt) => receipt.key === key)?.hash !==
          hash
        ) {
          throw runException(
            409,
            ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
            "该请求键已用于其他消息",
          );
        }
        await this.expire(manager, replay);
        return (await snapshotRun(manager, replay, conversation)).run;
      }

      this.requireEngine();
      const active = await runs.findOneBy({
        conversationId: conversation.id,
        status: In(RUN_ACTIVE_STATUSES),
      });
      if (active && !(await this.expire(manager, active))) {
        const metadata = RunMetadata.parse(active.metadata ?? {});
        if (
          active.status !== "waiting_input" ||
          !metadata.interrupt ||
          attachments.length > 0
        ) {
          throw runException(
            409,
            ERROR_CODES.CONVERSATION_BUSY,
            "会话已有运行中的任务，请等待它完成",
          );
        }
        metadata.receipts.push({ key, hash });
        await this.resumeLocked(
          manager,
          conversation,
          active,
          metadata,
          metadata.interrupt.interruptId,
          input.content,
        );
        return (await snapshotRun(manager, active, conversation)).run;
      }

      if (attachments.length !== 0) {
        const count = await manager.countBy(KnowledgeFileEntity, {
          projectId: conversation.projectId,
          uuid: In(attachments),
        });
        if (count !== attachments.length)
          throw runException(
            404,
            ERROR_CODES.FILE_NOT_FOUND,
            "附件不属于当前项目或已删除",
          );
      }

      const messages = manager.getRepository(MessageEntity);
      const user = await messages.save({
        conversationId: conversation.id,
        role: "user",
        content: input.content,
      });
      const assistant = await messages.save({
        conversationId: conversation.id,
        role: "assistant",
        content: "",
      });
      const run = await runs.save({
        conversationId: conversation.id,
        userMessageId: user.id,
        assistantMessageId: assistant.id,
        status: "queued",
        metadata: RunMetadata.parse({ attachments, receipts: [{ key, hash }] }),
      });
      await manager.update(ConversationEntity, conversation.id, {
        updatedAt: new Date(),
      });
      return (await snapshotRun(manager, run, conversation)).run;
    });
  };

  resume = async (
    ownerId: string,
    runId: string,
    interruptId: string,
    rawAnswer: string,
  ): Promise<RunResult> => {
    const answer = AgentTurn.shape.input.parse(rawAnswer);
    const scope = { runId: resourceId(runId) };
    const scopedOwner = resourceId(ownerId);
    const id = resourceId(interruptId);

    const result = await this.database.dataSource.transaction(
      async (manager) => {
        const conversation = await getOwnedConversation(
          manager,
          scopedOwner,
          scope,
        );
        const run = await manager.findOneByOrFail(RunEntity, {
          uuid: scope.runId,
          conversationId: conversation.id,
        });
        const metadata = RunMetadata.parse(run.metadata ?? {});
        if (metadata.usedInterrupts[id]) {
          if (metadata.usedInterrupts[id] !== digest(answer)) {
            throw runException(
              409,
              ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
              "该澄清已提交过其他回答",
            );
          }
          await this.expire(manager, run);
          return (await snapshotRun(manager, run, conversation)).run;
        }
        if (await this.expire(manager, run)) return null;
        this.requireEngine();
        await this.resumeLocked(
          manager,
          conversation,
          run,
          metadata,
          id,
          answer,
        );
        return (await snapshotRun(manager, run, conversation)).run;
      },
    );
    if (!result) throw notResumable();
    return result;
  };

  private resumeLocked = async (
    manager: EntityManager,
    conversation: ConversationEntity,
    run: RunEntity,
    metadata: RunMetadata,
    interruptId: string,
    answer: string,
  ) => {
    if (
      run.status !== "waiting_input" ||
      metadata.interrupt?.interruptId !== interruptId ||
      !metadata.checkpoint
    ) {
      throw notResumable();
    }

    const response = await manager.save(MessageEntity, {
      conversationId: conversation.id,
      role: "user",
      content: answer,
    });
    const { assistant } = await getRunMessages(manager, run);
    const messageMetadata = MessageMetadata.parse(assistant.metadata ?? {});
    if (messageMetadata.card) {
      messageMetadata.card.status = "answered";
      messageMetadata.card.answer = { values: [answer], isCustom: true };
      messageMetadata.card.answeredAt = new Date().toISOString();
      await manager.update(MessageEntity, assistant.id, {
        metadata: messageMetadata,
      });
    }

    metadata.usedInterrupts[interruptId] = digest(answer);
    metadata.response = { messageId: response.id, answer };
    delete metadata.interrupt;
    run.status = "queued";
    run.metadata = metadata;
    await manager.save(RunEntity, run);
    await manager.update(ConversationEntity, conversation.id, {
      updatedAt: new Date(),
    });
  };

  /** Called after the acceptance transaction has committed, independently of any subscriber. */
  execute = async (ownerId: string, runId: string): Promise<void> => {
    const engine = this.requireEngine();
    const scope = { runId: resourceId(runId) };
    const scopedOwner = resourceId(ownerId);
    const claim = await this.claim(scopedOwner, scope);
    if (!claim) return;

    const controller = new AbortController();
    this.running.set(scope.runId, controller);
    const deadlineAt = Date.now() + RUN_TIMEOUT_MS;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(RUN_TIMEOUT_MS),
    ]);

    try {
      const result = AgentTurnResult.parse(
        await engine.execute(claim.turn, {
          resume: claim.resume,
          signal,
          deadlineAt,
        }),
      );
      signal.throwIfAborted();
      const completion = await this.commit(scopedOwner, scope, claim, result);
      if (completion && result.status === "succeeded") {
        const finishExtras = async () => {
          try {
            await this.persistExtras(engine, claim, result.text, completion);
          } catch {
            this.logger.warn(`生成会话辅助内容失败 runId=${scope.runId}`);
          }
        };
        void finishExtras();
      }
    } catch (error) {
      const code =
        error instanceof AgentExecutionError
          ? error.code
          : ERROR_CODES.SERVICE_UNAVAILABLE;
      const message =
        error instanceof AgentExecutionError
          ? error.message
          : "架构生成暂时失败，请重试";
      const detached =
        error instanceof HttpException && error.getStatus() === 404;
      if (!detached) {
        await this.database.dataSource.transaction(async (manager) => {
          await getOwnedConversation(manager, scopedOwner, scope);
          const run = await manager.findOneByOrFail(RunEntity, {
            uuid: scope.runId,
          });
          if (this.ownsClaim(run, claim))
            await this.finish(manager, run, "failed", { code, message });
        });
        this.logger.warn(`运行失败 runId=${scope.runId} code=${code}`);
      }
    } finally {
      this.running.delete(scope.runId);
    }
  };

  private claim = async (
    ownerId: string,
    scope: { runId: string },
  ): Promise<ClaimedRun | null> => {
    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(manager, ownerId, scope);
      const run = await manager.findOneByOrFail(RunEntity, {
        uuid: scope.runId,
        conversationId: conversation.id,
      });
      if ((await this.expire(manager, run)) || run.status !== "queued")
        return null;

      const metadata = RunMetadata.parse(run.metadata ?? {});
      const { user, assistant } = await getRunMessages(manager, run);
      const project = await manager.findOneByOrFail(ProjectEntity, {
        id: conversation.projectId,
      });
      const state = await manager.findOneBy(AgentStateEntity, {
        conversationId: conversation.id,
      });
      const exclude = [
        user.id,
        assistant.id,
        ...(metadata.response ? [metadata.response.messageId] : []),
      ];
      const history = await manager
        .getRepository(MessageEntity)
        .createQueryBuilder("message")
        .where("message.conversation_id = :conversationId", {
          conversationId: conversation.id,
        })
        .andWhere("message.id NOT IN (:...exclude)", { exclude })
        .andWhere(
          "message.role IN ('user', 'assistant') AND message.content <> ''",
        )
        .orderBy("message.created_at", "DESC")
        .addOrderBy("message.id", "DESC")
        .take(AGENT_HISTORY_LIMIT)
        .getMany();

      const draft = GraphInput.nullable().safeParse(
        conversation.currentDraftGraph,
      );
      if (!draft.success) {
        await this.finish(manager, run, "failed", {
          code: ERROR_CODES.GRAPH_INVALID,
          message: "当前画布的数据无效，请修复画布后重试",
        });
        return null;
      }
      const parsedTurn = AgentTurn.safeParse({
        runId: run.uuid,
        conversationId: conversation.uuid,
        projectId: project.uuid,
        input: user.content,
        attachments: metadata.attachments,
        history: history
          .reverse()
          .map(({ role, content }) => ({ role, content })),
        draftGraph: draft.data,
        draftVersion: conversation.draftVersion,
        constraints: state?.constraintsData ?? {},
      });
      if (!parsedTurn.success) {
        await this.finish(manager, run, "failed", {
          code: ERROR_CODES.RUN_NOT_RESUMABLE,
          message: "会话状态无效，请重新发送请求",
        });
        return null;
      }
      const resume =
        metadata.checkpoint && metadata.response
          ? {
              checkpoint: metadata.checkpoint,
              answer: metadata.response.answer,
            }
          : undefined;
      const token = randomUUID();
      metadata.lease = {
        token,
        expiresAt: new Date(Date.now() + LEASE_TIMEOUT_MS).toISOString(),
      };
      run.status = "running";
      run.metadata = metadata;
      await manager.save(RunEntity, run);
      return {
        turn: parsedTurn.data,
        resume,
        token,
        stateVersion: state?.version ?? 0,
      };
    });
  };

  private commit = async (
    ownerId: string,
    scope: { runId: string },
    claim: ClaimedRun,
    result: AgentTurnResult,
  ) => {
    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(manager, ownerId, scope);
      const run = await manager.findOneByOrFail(RunEntity, {
        uuid: scope.runId,
        conversationId: conversation.id,
      });
      if (!this.ownsClaim(run, claim) || (await this.expire(manager, run)))
        return null;

      const state = await manager.findOneBy(AgentStateEntity, {
        conversationId: conversation.id,
      });
      if ((state?.version ?? 0) !== claim.stateVersion) {
        await this.finish(manager, run, "failed", {
          code: ERROR_CODES.RUN_NOT_RESUMABLE,
          message: "会话约束已更新，请重新发送请求",
        });
        return null;
      }

      const now = new Date();
      const graph =
        result.status === "succeeded" && result.graph
          ? GraphInput.parse(result.graph)
          : null;
      if (graph) {
        const saved = await manager.update(
          ConversationEntity,
          { id: conversation.id, draftVersion: claim.turn.draftVersion },
          {
            currentDraftGraph: graph,
            draftVersion: claim.turn.draftVersion + 1,
            updatedAt: now,
          },
        );
        if (saved.affected !== 1) {
          await this.finish(manager, run, "failed", {
            code: ERROR_CODES.DRAFT_VERSION_CONFLICT,
            message: "画布已有更新，请基于当前画布重试",
          });
          return null;
        }
      } else {
        await manager.update(ConversationEntity, conversation.id, {
          updatedAt: now,
        });
      }

      await manager.save(AgentStateEntity, {
        id: state?.id,
        conversationId: conversation.id,
        currentStep: result.status,
        version: claim.stateVersion + 1,
        constraintsData: result.constraints,
      });

      const { assistant } = await getRunMessages(manager, run);
      const messageMetadata = MessageMetadata.parse(assistant.metadata ?? {});
      const metadata = RunMetadata.parse(run.metadata ?? {});
      if (result.status === "waiting_input") {
        const interrupt = Interrupt.parse({
          interruptId: randomUUID(),
          kind: "clarification",
          node: "resolve_intent",
          payload: { question: result.checkpoint.question },
          expiresAt: new Date(
            now.getTime() + INTERRUPT_TIMEOUT_MS,
          ).toISOString(),
        });
        messageMetadata.card = {
          id: interrupt.interruptId,
          messageId: assistant.uuid,
          kind: "text",
          title: result.checkpoint.question,
          options: [],
          status: "pending",
          answer: null,
          createdAt: now.toISOString(),
          answeredAt: null,
        };
        await manager.update(MessageEntity, assistant.id, {
          content: result.text,
          metadata: messageMetadata,
        });
        delete metadata.lease;
        delete metadata.response;
        metadata.interrupt = interrupt;
        metadata.checkpoint = result.checkpoint;
        run.status = "waiting_input";
        run.metadata = metadata;
        await manager.save(RunEntity, run);
        return null;
      }

      await manager.update(MessageEntity, assistant.id, {
        content: result.text,
        graphSnapshot: graph,
        metadata: { ...messageMetadata, citations: result.citations },
      });
      await this.finish(manager, run, "succeeded");
      return {
        assistantId: assistant.id,
        conversationId: conversation.id,
        title: conversation.title,
        updatedAt: now,
      };
    });
  };

  snapshot = async (ownerId: string, runId: string) => {
    const scope = { runId: resourceId(runId) };
    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(
        manager,
        resourceId(ownerId),
        scope,
      );
      const run = await manager.findOneByOrFail(RunEntity, {
        uuid: scope.runId,
        conversationId: conversation.id,
      });
      await this.expire(manager, run);
      return snapshotRun(manager, run, conversation);
    });
  };

  cancel = async (ownerId: string, runId: string) => {
    const scope = { runId: resourceId(runId) };
    const accepted = await this.database.dataSource.transaction(
      async (manager) => {
        const conversation = await getOwnedConversation(
          manager,
          resourceId(ownerId),
          scope,
        );
        const run = await manager.findOneByOrFail(RunEntity, {
          uuid: scope.runId,
          conversationId: conversation.id,
        });
        if (RUN_ACTIVE_STATUSES.includes(run.status))
          await this.finish(manager, run, "canceled");
        return (await snapshotRun(manager, run, conversation)).run;
      },
    );
    if (accepted.status === "canceled") this.running.get(scope.runId)?.abort();
    return accepted;
  };

  onModuleDestroy = () => {
    for (const controller of this.running.values()) controller.abort();
  };

  private requireEngine = (): RunEngine => {
    if (!this.engine)
      throw runException(
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "Agent 尚未配置模型服务",
      );
    return this.engine;
  };

  private ownsClaim = (run: RunEntity, claim: ClaimedRun) =>
    run.status === "running" &&
    RunMetadata.parse(run.metadata).lease?.token === claim.token;

  private expire = async (
    manager: EntityManager,
    run: RunEntity,
  ): Promise<boolean> => {
    const metadata = RunMetadata.parse(run.metadata ?? {});
    if (
      run.status === "running" &&
      (!metadata.lease || hasExpired(metadata.lease.expiresAt))
    ) {
      await this.finish(manager, run, "failed", {
        code: ERROR_CODES.RUN_NOT_RESUMABLE,
        message: "运行超时，请重新发起请求",
      });
      return true;
    }
    if (
      run.status === "waiting_input" &&
      hasExpired(metadata.interrupt?.expiresAt)
    ) {
      await this.finish(manager, run, "canceled");
      return true;
    }
    return false;
  };

  private finish = async (
    manager: EntityManager,
    run: RunEntity,
    status: "succeeded" | "failed" | "canceled",
    error?: { code: string; message: string },
  ) => {
    const metadata = RunMetadata.parse(run.metadata ?? {});
    if (run.status === "waiting_input") {
      const { assistant } = await getRunMessages(manager, run);
      const messageMetadata = MessageMetadata.parse(assistant.metadata ?? {});
      if (messageMetadata.card?.status === "pending") {
        messageMetadata.card.status = hasExpired(metadata.interrupt?.expiresAt)
          ? "expired"
          : "ignored";
        await manager.update(MessageEntity, assistant.id, {
          metadata: messageMetadata,
        });
      }
    }

    delete metadata.checkpoint;
    delete metadata.interrupt;
    delete metadata.lease;
    delete metadata.response;
    Object.assign(run, {
      status,
      metadata,
      finishReason:
        status === "succeeded"
          ? "stop"
          : status === "failed"
            ? "error"
            : "canceled",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
      finishedAt: new Date(),
    });
    await manager.save(RunEntity, run);
  };

  private persistExtras = async (
    engine: RunEngine,
    claim: ClaimedRun,
    assistantText: string,
    completion: {
      assistantId: string;
      conversationId: string;
      title: string;
      updatedAt: Date;
    },
  ) => {
    const includeTitle = completion.title === DEFAULT_TITLE;
    const extras = await engine.generateExtras(
      { userInput: claim.turn.input, assistantText, includeTitle },
      AbortSignal.timeout(EXTRAS_TIMEOUT_MS),
    );
    await this.database.dataSource.transaction(async (manager) => {
      const conversation = await manager.findOne(ConversationEntity, {
        where: { id: completion.conversationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!conversation) return;
      const assistant = await manager.findOneBy(MessageEntity, {
        id: completion.assistantId,
        conversationId: completion.conversationId,
      });
      if (!assistant) return;
      const metadata = MessageMetadata.parse(assistant.metadata ?? {});
      await manager.update(MessageEntity, assistant.id, {
        metadata: {
          ...metadata,
          suggestedQuestions: extras.suggestedQuestions,
        },
      });
      if (includeTitle && extras.title) {
        await manager.update(
          ConversationEntity,
          {
            id: completion.conversationId,
            title: DEFAULT_TITLE,
            updatedAt: completion.updatedAt,
          },
          {
            title: extras.title,
            updatedAt: completion.updatedAt,
          },
        );
      }
    });
  };
}
