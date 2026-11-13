import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { In, type Repository } from "typeorm";
import {
  ERROR_CODES,
  Graph,
  runStreamUrl,
  type AnswerCardInput,
  type CancelResult,
  type FinishReason,
  type MessageMetadata,
  type Run,
  type RunAccepted,
  type RunMetadata,
  type RunStatus,
  type SendMessageInput,
  type SseFrame,
} from "@arch-flow/shared";
import {
  AgentEngine,
  type AgentEvent,
  type ArchitectureGraph,
} from "@arch-flow/agent";
import {
  AgentStateEntity,
  ConversationEntity,
  MessageEntity,
  RunEntity,
} from "@arch-flow/db";
import { apiError } from "../../common/api-error.js";
import type { AuthUser } from "../../common/request-context.js";
import { loadEnv } from "../../config/env.js";
import { DatabaseService } from "../../database/database.service.js";
import { ConversationService } from "../conversation/conversation.service.js";
import { RagService } from "../rag/rag.service.js";
import { SseHubService } from "./sse-hub.service.js";

const ACTIVE_STATUSES: RunStatus[] = ["queued", "running", "waiting_input"];
const RECENT_MESSAGE_LIMIT = 10;

type ResumeAnswer = {
  field: string;
  values: string[];
  isCustom: boolean;
};

/** 一次 resume 可带回多个约束字段（卡片 steps）。 */
type ResumeInput = ResumeAnswer[];

@Injectable()
export class RunService {
  private readonly logger = new Logger(RunService.name);
  private readonly agent: AgentEngine;
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly database: DatabaseService,
    private readonly conversations: ConversationService,
    private readonly rag: RagService,
    private readonly hub: SseHubService,
  ) {
    const env = loadEnv();
    this.agent = new AgentEngine({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
      model: env.OPENAI_MODEL,
      maxTokens: env.LLM_MAX_TOKENS,
    });
  }

  private readonly runRepository = (): Repository<RunEntity> =>
    this.database.dataSource.getRepository(RunEntity);

  private readonly messageRepository = (): Repository<MessageEntity> =>
    this.database.dataSource.getRepository(MessageEntity);

  private readonly conversationRepository = (): Repository<ConversationEntity> =>
    this.database.dataSource.getRepository(ConversationEntity);

  private readonly stateRepository = (): Repository<AgentStateEntity> =>
    this.database.dataSource.getRepository(AgentStateEntity);

  sendMessage = async (
    user: AuthUser,
    conversationUuid: string,
    input: SendMessageInput,
    traceId: string,
  ): Promise<RunAccepted> => {
    const conversation = await this.conversations.requireEntity(
      user,
      conversationUuid,
    );
    const active = await this.findActiveRun(conversation.id);

    if (active && active.status !== "waiting_input") {
      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.CONVERSATION_BUSY,
        "会话正在生成中",
        undefined,
        { activeRunId: active.uuid },
      );
    }

    const userMessage = await this.createMessage(
      conversation.id,
      "user",
      input.content,
      null,
    );

    if (active) {
      const field = this.interruptField(active) ?? "clarification";
      const resume: ResumeInput = [
        {
          field,
          values: [input.content],
          isCustom: true,
        },
      ];
      await this.markWaitingCardIgnored(active, input.content);
      await this.resumeRun(active, conversation.id, traceId, resume);

      return this.accepted(active, userMessage, resume);
    }

    const assistant = await this.createMessage(
      conversation.id,
      "assistant",
      "",
      null,
    );
    const run = await this.createRun(
      conversation.id,
      userMessage.id,
      assistant.id,
      traceId,
    );

    void this.execute(run.id, traceId, null, false);

    return this.accepted(run, userMessage, null);
  };

  answerCard = async (
    user: AuthUser,
    conversationUuid: string,
    messageUuid: string,
    input: AnswerCardInput,
    traceId: string,
  ): Promise<RunAccepted> => {
    const conversation = await this.conversations.requireEntity(
      user,
      conversationUuid,
    );
    const message = await this.conversations.requireMessage(
      conversation.id,
      messageUuid,
    );
    const metadata = this.messageMetadata(message);
    const card = metadata.card;

    if (!card || (input.cardId && input.cardId !== card.id)) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.CARD_NOT_FOUND,
        "卡片不存在",
      );
    }

    if (card.status === "answered") {
      /**
       * resume 后会创建新的 assistant 消息，run.assistantMessageId 不再等于
       * 卡片所在消息；因此按会话找最近一次 run 重放结果。
       */
      const previous = await this.runRepository().findOne({
        where: { conversationId: conversation.id },
        order: { createdAt: "DESC", id: "DESC" },
      });

      if (previous) {
        const userMessage = await this.messageRepository().findOneBy({
          id: previous.userMessageId,
        });

        if (userMessage) {
          return this.accepted(previous, userMessage, null);
        }
      }

      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.CARD_EXPIRED,
        "卡片已回答",
      );
    }

    if (card.status === "expired" || card.status === "ignored") {
      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.CARD_EXPIRED,
        "卡片已失效",
      );
    }

    const active = await this.findActiveRun(conversation.id);

    if (active && active.status !== "waiting_input") {
      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.CONVERSATION_BUSY,
        "会话正在生成中",
        undefined,
        { activeRunId: active.uuid },
      );
    }

    const fallbackField =
      card.steps?.[0]?.id ??
      (active ? this.interruptField(active) : undefined) ??
      "note";
    const answers: Record<string, { values: string[]; isCustom: boolean }> =
      input.answers ??
      (input.values
        ? {
            [fallbackField]: {
              values: input.values,
              isCustom: input.isCustom,
            },
          }
        : {});

    if (Object.keys(answers).length === 0) {
      throw apiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ERROR_CODES.VALIDATION_FAILED,
        "缺少卡片答案",
      );
    }

    const firstAnswer = Object.values(answers)[0];
    const answeredAt = new Date().toISOString();
    message.metadata = {
      ...metadata,
      card: {
        ...card,
        status: "answered",
        answer: firstAnswer
          ? {
              values: firstAnswer.values,
              isCustom: firstAnswer.isCustom,
            }
          : null,
        answers: Object.fromEntries(
          Object.entries(answers).map(([field, answer]) => [
            field,
            {
              values: answer.values,
              isCustom: answer.isCustom,
            },
          ]),
        ),
        answeredAt,
      },
    };
    await this.messageRepository().save(message);

    const labelParts = Object.entries(answers).map(([field, answer]) => {
      const step = card.steps?.find((item) => item.id === field);
      const options = step?.options ?? card.options;

      return answer.values
        .map(
          (value) =>
            options.find((option) => option.value === value)?.label ?? value,
        )
        .join("、");
    });
    const userMessage = await this.createMessage(
      conversation.id,
      "user",
      `已选择：${labelParts.join("；")}`,
      null,
    );
    const resume: ResumeInput = Object.entries(answers).map(
      ([field, answer]) => ({
        field,
        values: answer.values,
        isCustom: answer.isCustom,
      }),
    );

    if (active) {
      await this.resumeRun(active, conversation.id, traceId, resume);

      return this.accepted(active, userMessage, resume);
    }

    const assistant = await this.createMessage(
      conversation.id,
      "assistant",
      "",
      null,
    );
    const run = await this.createRun(
      conversation.id,
      userMessage.id,
      assistant.id,
      traceId,
    );

    void this.execute(run.id, traceId, resume, false);

    return this.accepted(run, userMessage, null);
  };

  getRun = async (user: AuthUser, runUuid: string): Promise<Run> => {
    const run = await this.requireRun(user, runUuid);
    const [conversation, userMessage, assistant] = await Promise.all([
      this.conversationRepository().findOneBy({ id: run.conversationId }),
      this.messageRepository().findOneBy({ id: run.userMessageId }),
      this.messageRepository().findOneBy({ id: run.assistantMessageId }),
    ]);

    if (!conversation || !userMessage || !assistant) {
      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.RUN_NOT_RESUMABLE,
        "运行关联数据缺失",
      );
    }

    return {
      id: run.uuid,
      conversationId: conversation.uuid,
      userMessageId: userMessage.uuid,
      assistantMessageId: assistant.uuid,
      status: run.status as RunStatus,
      finishReason: run.finishReason as FinishReason | null,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      error:
        run.status === "failed"
          ? {
              code: run.errorCode ?? ERROR_CODES.INTERNAL_ERROR,
              message: run.errorMessage ?? "运行失败",
            }
          : null,
    };
  };

  cancel = async (user: AuthUser, runUuid: string): Promise<CancelResult> => {
    const run = await this.requireRun(user, runUuid);

    if (this.isTerminal(run.status)) {
      return { runId: run.uuid, status: run.status as RunStatus };
    }

    const controller = this.controllers.get(run.uuid);

    if (run.status === "waiting_input") {
      await this.finalizeRun(run, "canceled", "canceled");
      this.hub.publish(run.uuid, {
        type: "done",
        assistantMessageId: await this.assistantUuid(run),
        finishReason: "canceled",
      } satisfies SseFrame);
      this.hub.markTerminal(run.uuid);

      return { runId: run.uuid, status: "canceled" };
    }

    if (controller) {
      controller.abort();

      return { runId: run.uuid, status: "running" };
    }

    return { runId: run.uuid, status: run.status as RunStatus };
  };

  /** SSE 连接：负责重放、实时订阅、心跳与断开清理。 */
  stream = async (
    user: AuthUser,
    runUuid: string,
    lastEventId: number | undefined,
    request: { on: (event: string, callback: () => void) => void },
    response: {
      setHeader: (name: string, value: string) => void;
      flushHeaders: () => void;
      write: (chunk: string) => void;
      end: () => void;
      status: (code: number) => unknown;
    },
  ): Promise<void> => {
    const run = await this.requireRun(user, runUuid);
    const channelExists = this.hub.hasBuffer(run.uuid);
    let cursor = lastEventId;

    /**
     * 服务重启或缓冲区重建后，客户端的 Last-Event-ID 会大于新缓冲的最新 id。
     * 这不是数据损坏，不能直接 409 让用户重发；忽略旧游标、从新缓冲全量重放。
     */
    if (
      channelExists &&
      cursor !== undefined &&
      cursor >= this.hub.lastId(run.uuid)
    ) {
      this.logger.warn(
        `run ${run.uuid} 的 Last-Event-ID ${cursor} 超出当前缓冲，按全量重放处理`,
      );
      cursor = undefined;
    }

    response.status(HttpStatus.OK);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    const writeFrame = (id: number, frame: SseFrame): void => {
      response.write(`id: ${id}\ndata: ${JSON.stringify(frame)}\n\n`);
    };
    const endStream = (): void => {
      response.write("data: [DONE]\n\n");
      response.end();
    };

    if (run.status === "waiting_input") {
      const interrupt = this.runMetadata(run).interrupt;

      if (interrupt) {
        const start = await this.buildRunStart(run, true);
        writeFrame(1, start);
        writeFrame(2, { type: "interrupt", ...interrupt });
      }

      response.end();
      return;
    }

    if (channelExists) {
      const frames = this.hub.replay(run.uuid, cursor);

      for (const frame of frames) {
        response.write(`id: ${frame.id}\ndata: ${frame.data}\n\n`);
        const parsed = JSON.parse(frame.data) as SseFrame;

        if (parsed.type === "done") {
          endStream();
          return;
        }

        if (parsed.type === "interrupt") {
          response.end();
          return;
        }
      }

      if (this.isTerminal(run.status)) {
        endStream();
        return;
      }

      let closed = false;
      const close = (): void => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      const unsubscribe = this.hub.subscribe(run.uuid, (frame) => {
        response.write(`id: ${frame.id}\ndata: ${frame.data}\n\n`);
        const parsed = JSON.parse(frame.data) as SseFrame;

        if (parsed.type === "done") {
          endStream();
          close();
        } else if (parsed.type === "interrupt") {
          response.end();
          close();
        }
      });
      const heartbeat = setInterval(() => {
        response.write(": ping\n\n");
      }, 15_000);
      request.on("close", close);

      return;
    }

    /** 缓冲失效：按数据库合成快照重放（P0-06）。 */
    const snapshot = await this.buildSnapshot(run);
    let id = 1;

    for (const frame of snapshot) {
      writeFrame(id, frame);
      id += 1;
    }

    if (snapshot.some((frame) => frame.type === "done")) {
      endStream();
      return;
    }

    if (run.status === "waiting_input" || this.isTerminal(run.status)) {
      response.end();
      return;
    }

    let closed = false;
    const close = (): void => {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    const unsubscribe = this.hub.subscribe(run.uuid, (frame) => {
      writeFrame(frame.id, JSON.parse(frame.data) as SseFrame);

      if (frame.data.includes('"type":"done"')) {
        endStream();
        close();
      }
    });
    const heartbeat = setInterval(() => {
      response.write(": ping\n\n");
    }, 15_000);
    request.on("close", close);
  };

  private readonly execute = async (
    runInternalId: string,
    traceId: string,
    resume: ResumeInput | null,
    resumeFlag: boolean,
  ): Promise<void> => {
    const run = await this.runRepository().findOneBy({ id: runInternalId });

    if (!run) {
      return;
    }

    const controller = new AbortController();
    this.controllers.set(run.uuid, controller);
    await this.updateRun(run, { status: "running" });

    try {
      const conversation = await this.conversationRepository().findOneBy({
        id: run.conversationId,
      });
      const userMessage = await this.messageRepository().findOneBy({
        id: run.userMessageId,
      });
      const assistant = await this.messageRepository().findOneBy({
        id: run.assistantMessageId,
      });

      if (!conversation || !userMessage || !assistant) {
        throw new Error("运行关联数据缺失");
      }

      const citations = await this.rag.search(
        conversation.projectId,
        userMessage.content,
      );
      const recent = await this.messageRepository()
        .createQueryBuilder("message")
        .where("message.conversationId = :conversationId", {
          conversationId: conversation.id,
        })
        .andWhere("message.id <> :assistantId", { assistantId: assistant.id })
        .andWhere("message.role <> :system", { system: "system" })
        .orderBy("message.createdAt", "DESC")
        .addOrderBy("message.id", "DESC")
        .take(RECENT_MESSAGE_LIMIT)
        .getMany();
      const constraints = await this.loadConstraints(conversation.id);
      const draft = Graph.safeParse(conversation.currentDraftGraph);

      this.hub.ensure(run.uuid);
      this.hub.publish(run.uuid, {
        ...(await this.buildRunStart(run, resumeFlag)),
      } satisfies SseFrame);

      const events = this.agent.run({
        userMessage: userMessage.content,
        conversationTitle: conversation.title,
        constraints,
        recentMessages: [...recent].reverse().map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
        draftGraph: draft.success ? (draft.data as ArchitectureGraph) : null,
        citations,
        assistantMessageId: assistant.uuid,
        designRounds: this.runMetadata(run).designRounds ?? 0,
        resume: resume ?? undefined,
        signal: controller.signal,
      });

      let content = assistant.content;
      let persistedLength = assistant.content.length;
      let lastFlush = Date.now();
      let metadata = this.messageMetadata(assistant);

      const flushContent = async (force = false): Promise<void> => {
        const shouldFlush =
          force ||
          Date.now() - lastFlush >= 500 ||
          content.length - persistedLength >= 200;

        if (!shouldFlush) {
          return;
        }

        assistant.content = content;
        assistant.metadata = metadata;
        await this.messageRepository().save(assistant);
        persistedLength = content.length;
        lastFlush = Date.now();
      };

      for await (const event of events) {
        if (controller.signal.aborted) {
          break;
        }

        await this.handleEvent(
          event,
          run,
          conversation,
          assistant,
          traceId,
          content,
          metadata,
          flushContent,
          (nextContent) => {
            content = nextContent;
          },
          (nextMetadata) => {
            metadata = nextMetadata;
          },
        );

        if (
          event.type === "interrupt" ||
          event.type === "done" ||
          event.type === "error"
        ) {
          return;
        }
      }

      /** 取消只中断推送；这里补终态并保留已生成内容。 */
      if (controller.signal.aborted) {
        assistant.content = content;
        assistant.metadata = metadata;
        await this.messageRepository().save(assistant);
        await this.finalizeRun(run, "canceled", "canceled");
        this.hub.publish(run.uuid, {
          type: "done",
          assistantMessageId: assistant.uuid,
          finishReason: "canceled",
        } satisfies SseFrame);
        this.hub.markTerminal(run.uuid);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        await this.finalizeRun(run, "canceled", "canceled");
        this.hub.publish(run.uuid, {
          type: "done",
          assistantMessageId: await this.assistantUuid(run),
          finishReason: "canceled",
        } satisfies SseFrame);
        this.hub.markTerminal(run.uuid);
      } else {
        await this.failRun(run, error);
      }
    } finally {
      this.controllers.delete(run.uuid);
    }
  };

  private readonly handleEvent = async (
    event: AgentEvent,
    run: RunEntity,
    conversation: ConversationEntity,
    assistant: MessageEntity,
    traceId: string,
    content: string,
    metadata: MessageMetadata,
    flushContent: (force?: boolean) => Promise<void>,
    setContent: (content: string) => void,
    setMetadata: (metadata: MessageMetadata) => void,
  ): Promise<void> => {
    switch (event.type) {
      case "status": {
        this.hub.publish(run.uuid, { type: "status", stage: event.stage });
        return;
      }
      case "text-delta": {
        setContent(content + event.content);
        this.hub.publish(run.uuid, {
          type: "text-delta",
          messageId: assistant.uuid,
          content: event.content,
        });
        await flushContent();
        return;
      }
      case "graph": {
        conversation.currentDraftGraph = event.graph;
        conversation.draftVersion += 1;
        await this.conversationRepository().save(conversation);
        assistant.graphSnapshot = event.graph;
        await this.messageRepository().save(assistant);
        this.hub.publish(run.uuid, {
          type: "graph",
          graph: event.graph,
          replace: true,
        });
        return;
      }
      case "citation": {
        const next = { ...metadata, citations: event.sources };
        setMetadata(next);
        this.hub.publish(run.uuid, {
          type: "citation",
          sources: event.sources,
        });
        return;
      }
      case "constraint-card": {
        const next = { ...metadata, card: event.card };
        setMetadata(next);
        this.hub.publish(run.uuid, {
          type: "constraint-card",
          messageId: assistant.uuid,
          card: event.card,
        });
        return;
      }
      case "constraints": {
        await this.saveConstraints(conversation.id, event.constraints);
        return;
      }
      case "title": {
        conversation.title = event.title;
        await this.conversationRepository().save(conversation);
        this.hub.publish(run.uuid, {
          type: "title",
          conversationId: conversation.uuid,
          title: event.title,
        });
        return;
      }
      case "usage": {
        const usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          model: event.model,
          latencyMs: event.latencyMs,
        };
        setMetadata({ ...metadata, usage });
        run.usage = usage;
        await this.runRepository().save(run);
        this.hub.publish(run.uuid, { type: "usage", ...usage });
        return;
      }
      case "interrupt": {
        setMetadata(metadata);
        assistant.content = content;
        assistant.metadata = metadata;
        await this.messageRepository().save(assistant);
        run.status = "waiting_input";
        const nextDesignRounds = event.interrupt.payload.designRounds;
        const currentMetadata = this.runMetadata(run);
        run.metadata = {
          ...currentMetadata,
          interrupt: event.interrupt,
          traceId,
          ...(typeof nextDesignRounds === "number"
            ? { designRounds: nextDesignRounds }
            : {}),
        };
        await this.runRepository().save(run);
        this.hub.publish(run.uuid, {
          type: "interrupt",
          ...event.interrupt,
        });
        this.hub.markTerminal(run.uuid);
        return;
      }
      case "done": {
        setMetadata(metadata);
        assistant.content = content;
        assistant.metadata = metadata;
        await this.messageRepository().save(assistant);
        await this.finalizeRun(run, "succeeded", event.finishReason);
        this.hub.publish(run.uuid, {
          type: "done",
          assistantMessageId: assistant.uuid,
          finishReason: event.finishReason,
        });
        this.hub.markTerminal(run.uuid);
        return;
      }
      case "error": {
        throw new Error(`${event.code}: ${event.message}`);
      }
      default:
        return;
    }
  };

  private readonly failRun = async (
    run: RunEntity,
    error: unknown,
  ): Promise<void> => {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "运行失败";
    this.logger.error(`run ${run.uuid} 失败：${message}`);

    if (run.status === "waiting_input") {
      return;
    }

    await this.finalizeRun(
      run,
      "failed",
      "error",
      ERROR_CODES.INTERNAL_ERROR,
      message,
    );
    const assistantId = await this.assistantUuid(run);
    this.hub.publish(run.uuid, {
      type: "error",
      code: ERROR_CODES.INTERNAL_ERROR,
      message,
      retryable: false,
    } satisfies SseFrame);
    this.hub.publish(run.uuid, {
      type: "done",
      assistantMessageId: assistantId,
      finishReason: "error",
    } satisfies SseFrame);
    this.hub.markTerminal(run.uuid);
  };

  private readonly buildRunStart = async (
    run: RunEntity,
    resume: boolean,
  ): Promise<SseFrame> => {
    const [conversation, userMessage, assistant] = await Promise.all([
      this.conversationRepository().findOneBy({ id: run.conversationId }),
      this.messageRepository().findOneBy({ id: run.userMessageId }),
      this.messageRepository().findOneBy({ id: run.assistantMessageId }),
    ]);

    if (!conversation || !userMessage || !assistant) {
      throw new Error("运行关联数据缺失");
    }

    return {
      type: "run-start",
      runId: run.uuid,
      conversationId: conversation.uuid,
      userMessageId: userMessage.uuid,
      assistantMessageId: assistant.uuid,
      traceId: this.runMetadata(run).traceId ?? randomUUID(),
      ...(resume ? { resume: true } : {}),
    };
  };

  private readonly buildSnapshot = async (
    run: RunEntity,
  ): Promise<SseFrame[]> => {
    const frames: SseFrame[] = [await this.buildRunStart(run, false)];
    const [conversation, assistant] = await Promise.all([
      this.conversationRepository().findOneBy({ id: run.conversationId }),
      this.messageRepository().findOneBy({ id: run.assistantMessageId }),
    ]);

    if (!assistant || !conversation) {
      return frames;
    }

    if (assistant.content) {
      frames.push({
        type: "text-delta",
        messageId: assistant.uuid,
        content: assistant.content,
        replace: true,
      });
    }

    const draft = Graph.safeParse(conversation.currentDraftGraph);

    if (draft.success) {
      frames.push({ type: "graph", graph: draft.data, replace: true });
    }

    const metadata = this.messageMetadata(assistant);

    if (metadata.citations && metadata.citations.length > 0) {
      frames.push({ type: "citation", sources: metadata.citations });
    }

    if (metadata.card && metadata.card.status === "pending") {
      frames.push({
        type: "constraint-card",
        messageId: assistant.uuid,
        card: metadata.card,
      });
    }

    if (metadata.usage) {
      frames.push({ type: "usage", ...metadata.usage });
    }

    const interrupt = this.runMetadata(run).interrupt;

    if (run.status === "waiting_input" && interrupt) {
      frames.push({ type: "interrupt", ...interrupt });
      return frames;
    }

    if (this.isTerminal(run.status)) {
      frames.push({
        type: "done",
        assistantMessageId: assistant.uuid,
        finishReason: (run.finishReason as FinishReason | null) ?? "error",
      });
    }

    return frames;
  };

  private readonly createMessage = async (
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    metadata: MessageMetadata | null,
  ): Promise<MessageEntity> => {
    const message = this.messageRepository().create({
      conversationId,
      role,
      content,
      metadata,
      graphSnapshot: null,
    });
    await this.messageRepository().save(message);

    return message;
  };

  private readonly createRun = async (
    conversationId: string,
    userMessageId: string,
    assistantMessageId: string,
    traceId: string,
  ): Promise<RunEntity> => {
    const run = this.runRepository().create({
      conversationId,
      userMessageId,
      assistantMessageId,
      status: "queued",
      finishReason: null,
      usage: null,
      metadata: { traceId },
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
    });
    await this.runRepository().save(run);

    return run;
  };

  /**
   * HITL resume 不复用旧 assistant 消息：
   * 用户回答消息先落库，再新建一条 assistant 消息，保证时间线是
   * 「用户回答 → AI 继续」，而不是把新回答追加到回答之前的旧气泡里。
   */
  private readonly resumeRun = async (
    run: RunEntity,
    conversationId: string,
    traceId: string,
    resume: ResumeInput,
  ): Promise<void> => {
    const assistant = await this.createMessage(
      conversationId,
      "assistant",
      "",
      null,
    );

    run.assistantMessageId = assistant.id;
    run.status = "queued";
    run.metadata = {
      ...this.runMetadata(run),
      resume: true,
      traceId,
      interrupt: null,
    };
    await this.runRepository().save(run);
    this.hub.reset(run.uuid);
    void this.execute(run.id, traceId, resume, true);
  };

  /** 用户不点卡片、直接发普通消息续聊时，把旧卡片标记为 ignored。 */
  private readonly markWaitingCardIgnored = async (
    run: RunEntity,
    content?: string,
  ): Promise<void> => {
    const message = await this.messageRepository().findOneBy({
      id: run.assistantMessageId,
    });

    if (!message) {
      return;
    }

    const metadata = this.messageMetadata(message);

    if (metadata.card?.status !== "pending") {
      return;
    }

    message.metadata = {
      ...metadata,
      card: {
        ...metadata.card,
        status: "ignored",
        answer: content
          ? { values: [content], isCustom: true }
          : metadata.card.answer,
        answeredAt: new Date().toISOString(),
      },
    };
    await this.messageRepository().save(message);
  };

  private readonly accepted = async (
    run: RunEntity,
    userMessage: MessageEntity,
    resume: ResumeInput | null,
  ): Promise<RunAccepted> => {
    const assistant = await this.messageRepository().findOneBy({
      id: run.assistantMessageId,
    });
    const conversation = await this.conversationRepository().findOneBy({
      id: run.conversationId,
    });

    if (!assistant || !conversation) {
      throw apiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.RUN_NOT_RESUMABLE,
        "运行关联数据缺失",
      );
    }

    if (resume) {
      /** 调用方负责启动 execute；这里只返回同一 run 句柄。 */
      void resume;
    }

    return {
      runId: run.uuid,
      userMessageId: userMessage.uuid,
      assistantMessageId: assistant.uuid,
      streamUrl: runStreamUrl(run.uuid),
      status: run.status as RunAccepted["status"],
    };
  };

  private readonly findActiveRun = async (
    conversationId: string,
  ): Promise<RunEntity | null> =>
    this.runRepository().findOne({
      where: {
        conversationId,
        status: In(ACTIVE_STATUSES),
      },
      order: { createdAt: "DESC", id: "DESC" },
    });

  private readonly requireRun = async (
    user: AuthUser,
    runUuid: string,
  ): Promise<RunEntity> => {
    const run = await this.runRepository().findOneBy({ uuid: runUuid });

    if (!run) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.RUN_NOT_FOUND,
        "运行不存在",
      );
    }

    const conversation = await this.conversationRepository().findOneBy({
      id: run.conversationId,
    });

    if (!conversation) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.RUN_NOT_FOUND,
        "运行不存在",
      );
    }

    await this.conversations.requireEntity(user, conversation.uuid);

    return run;
  };

  private readonly loadConstraints = async (
    conversationId: string,
  ): Promise<Record<string, unknown>> => {
    const state = await this.stateRepository().findOneBy({ conversationId });

    return state?.constraintsData ?? {};
  };

  private readonly saveConstraints = async (
    conversationId: string,
    constraints: Record<string, unknown>,
  ): Promise<void> => {
    const state = await this.stateRepository().findOneBy({ conversationId });

    if (state) {
      state.constraintsData = constraints;
      state.version += 1;
      state.currentStep = "COLLECT_CONSTRAINTS";
      await this.stateRepository().save(state);
      return;
    }

    await this.stateRepository().save(
      this.stateRepository().create({
        conversationId,
        currentStep: "COLLECT_CONSTRAINTS",
        constraintsData: constraints,
        version: 0,
      }),
    );
  };

  private readonly finalizeRun = async (
    run: RunEntity,
    status: "succeeded" | "failed" | "canceled",
    finishReason: FinishReason,
    errorCode: string | null = null,
    errorMessage: string | null = null,
  ): Promise<void> => {
    run.status = status;
    run.finishReason = finishReason;
    run.errorCode = errorCode;
    run.errorMessage = errorMessage;
    run.finishedAt = new Date();
    await this.runRepository().save(run);
  };

  private readonly updateRun = async (
    run: RunEntity,
    patch: Partial<RunEntity>,
  ): Promise<void> => {
    Object.assign(run, patch);
    await this.runRepository().save(run);
  };

  private readonly messageMetadata = (
    message: MessageEntity,
  ): MessageMetadata => (message.metadata as MessageMetadata | null) ?? {};

  private readonly runMetadata = (run: RunEntity): RunMetadata =>
    (run.metadata as RunMetadata | null) ?? {};

  private readonly interruptField = (run: RunEntity): string | undefined =>
    this.runMetadata(run).interrupt?.payload.field;

  private readonly assistantUuid = async (run: RunEntity): Promise<string> => {
    const assistant = await this.messageRepository().findOneBy({
      id: run.assistantMessageId,
    });

    return assistant?.uuid ?? randomUUID();
  };

  private readonly isTerminal = (status: string): boolean =>
    status === "succeeded" || status === "failed" || status === "canceled";
}
