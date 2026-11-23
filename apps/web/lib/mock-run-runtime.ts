import { createHash, randomUUID } from "node:crypto";
import {
  AGENT_HISTORY_LIMIT,
  AgentTurnResult,
  ERROR_CODES,
  type AgentCheckpoint,
  type AgentExtras,
  type AgentExtrasInput,
  type AgentResume,
  type AgentTurn,
  type CancelResult,
  type CardOption,
  type Message,
  type MockActiveRun,
  type MockConversationRecord,
  type MockDatabase,
  type MockSendMessageInput,
  type MockSseFrame,
  type MockStoredRun,
  type RunError,
  type RunStage,
} from "@arch-flow/shared";
import {
  acceptedRun,
  activeStatus,
  getReferencedGraph,
  getRunConversation,
  getRunMessage,
  getStoredRun,
  makeRunMessage,
  MockRunError,
  readMockGraph,
  snapshotRun,
  updateConversationMessages,
} from "./mock-run-data";
import { createMockRunFeed, type MockRunEvent } from "./mock-run-feed";

type Store = {
  read: (userId: string) => Promise<MockDatabase>;
  update: <Result>(
    userId: string,
    apply: (database: MockDatabase) => Result,
  ) => Promise<Result>;
};

type ExecutionOptions = {
  signal: AbortSignal;
  deadlineAt: number;
  resume?: AgentResume;
  onStage: (stage: RunStage) => void;
  onTextDelta: (delta: string, replace?: true) => Promise<void>;
};

export type MockRunDriver = {
  execute: (
    turn: AgentTurn,
    options: ExecutionOptions,
  ) => Promise<AgentTurnResult>;
  clarificationOptions?: (checkpoint: AgentCheckpoint) => CardOption[];
  generateExtras?: (
    input: AgentExtrasInput,
    signal: AbortSignal,
  ) => Promise<AgentExtras>;
};

type Emit = (frame: MockSseFrame) => void;
type TerminalStatus = "succeeded" | "failed" | "canceled";
type Worker = { controller: AbortController; flush?: () => Promise<void> };

const INTERRUPT_TIMEOUT_MS = 24 * 60 * 60_000;
const RUN_TIMEOUT_MS = 90_000;
const EXTRAS_TIMEOUT_MS = 25_000;
const TEXT_CHECKPOINT_MS = 300;
const TEXT_CHECKPOINT_CHARS = 800;
const DEFAULT_TITLE = "新会话";
const INTERRUPTED_RUN_ERROR: RunError = {
  code: ERROR_CODES.SERVICE_UNAVAILABLE,
  message: "本地运行中断。可以重新发送请求。",
};

const digest = (payload: unknown) =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");

const runError = (status: number, code: string, message: string) =>
  new MockRunError(status, code, message);

const makeEmitter =
  (run: MockStoredRun, pending: MockRunEvent[]): Emit =>
  (frame) =>
    pending.push({ id: ++run.cursor, frame });

const finishRun = (
  run: MockStoredRun,
  assistant: Message | undefined,
  emit: Emit,
  status: TerminalStatus,
  error?: RunError,
) => {
  const card = assistant?.metadata?.card;
  if (card?.status === "pending") {
    card.status =
      run.interrupt && Date.parse(run.interrupt.expiresAt) <= Date.now()
        ? "expired"
        : "ignored";
    emit({
      type: "card-updated",
      cardId: card.id,
      status: card.status,
      answer: null,
    });
  }
  run.finishReason =
    status === "succeeded"
      ? "stop"
      : status === "failed"
        ? "error"
        : "canceled";
  run.status = status;
  run.stage = null;
  run.workerId = null;
  run.finishedAt = new Date().toISOString();
  run.error = error ?? null;
  delete run.interrupt;
  delete run.checkpoint;
  delete run.resume;
  delete run.responseMessageId;
  if (error) emit({ type: "error", ...error, retryable: true });
  emit({
    type: "done",
    assistantMessageId: run.assistantMessageId,
    finishReason: run.finishReason,
  });
};

const makeRun = (
  conversation: MockConversationRecord,
  user: Message,
  assistant: Message,
  attachments: string[],
  workerId: string | null,
  graphReferenceMessageId?: MockStoredRun["graphReferenceMessageId"],
): MockStoredRun => ({
  id: randomUUID(),
  conversationId: conversation.id,
  userMessageId: user.id,
  assistantMessageId: assistant.id,
  status: "queued",
  workerId,
  attachments,
  graphReferenceMessageId,
  receipts: [],
  answeredInterrupts: [],
  cursor: 0,
  stage: null,
  traceId: randomUUID(),
  createdAt: assistant.createdAt,
  finishedAt: null,
  finishReason: null,
  error: null,
});

const pauseRun = (
  run: MockStoredRun,
  assistant: Message,
  result: Extract<AgentTurnResult, { status: "waiting_input" }>,
  options: CardOption[],
) => {
  const interrupt = {
    interruptId: randomUUID(),
    kind: "clarification" as const,
    node: "resolve_intent",
    payload: { question: result.checkpoint.question },
    expiresAt: new Date(Date.now() + INTERRUPT_TIMEOUT_MS).toISOString(),
  };
  const card = {
    id: interrupt.interruptId,
    messageId: assistant.id,
    kind: options.length ? ("single" as const) : ("text" as const),
    title: result.checkpoint.question,
    options,
    status: "pending" as const,
    answer: null,
    createdAt: new Date().toISOString(),
    answeredAt: null,
  };
  assistant.metadata = { ...assistant.metadata, card };
  run.status = "waiting_input";
  run.stage = null;
  run.workerId = null;
  run.interrupt = interrupt;
  run.checkpoint = result.checkpoint;
  delete run.resume;
  delete run.responseMessageId;
  return { interrupt, card };
};

const migrateLegacyPause = (conversation: MockConversationRecord) => {
  const pending = conversation.pendingAgentTurn;
  if (!pending) return;
  const assistantIndex = conversation.messages.findIndex(
    ({ id }) => id === pending.assistantMessageId,
  );
  const assistant = conversation.messages[assistantIndex];
  if (!assistant) return;
  const user = conversation.messages
    .slice(0, assistantIndex)
    .findLast(
      ({ role, content }) => role === "user" && content === pending.input,
    );
  if (!user) return;

  const run = makeRun(conversation, user, assistant, pending.attachments, null);
  run.id = pending.runId;
  pauseRun(
    run,
    assistant,
    {
      status: "waiting_input",
      text: pending.checkpoint.question,
      checkpoint: pending.checkpoint,
      constraints: conversation.agentConstraints ?? {},
    },
    [],
  );
  (conversation.runs ??= []).push(run);
  delete conversation.pendingAgentTurn;
};

const turnFor = (
  conversation: MockConversationRecord,
  run: MockStoredRun,
): AgentTurn => {
  const excluded = new Set([
    run.userMessageId,
    run.assistantMessageId,
    run.responseMessageId,
  ]);
  const referencedGraph = run.graphReferenceMessageId
    ? getReferencedGraph(conversation, run.graphReferenceMessageId)
    : undefined;
  return {
    runId: run.id,
    conversationId: conversation.id,
    projectId: conversation.projectId,
    input: getRunMessage(conversation, run.userMessageId).content,
    attachments: run.attachments,
    history: conversation.messages
      .flatMap(({ id, role, content }) =>
        role === "system" || excluded.has(id) || !content
          ? []
          : [{ role, content }],
      )
      .slice(-AGENT_HISTORY_LIMIT),
    draftVersion: conversation.draftVersion,
    draftGraph: readMockGraph(conversation.draftGraph),
    referencedGraph,
    constraints: conversation.agentConstraints ?? {},
  };
};

export const createMockRunRuntime = (storage: Store, driver: MockRunDriver) => {
  const workerId = randomUUID();
  const feed = createMockRunFeed();
  const workers = new Map<string, Worker>();
  let tail = Promise.resolve();

  const serialize = async <Result>(operation: () => Promise<Result>) => {
    const previous = tail;
    let release: () => void = () => undefined;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const channelKey = (userId: string, runId: string) => `${userId}:${runId}`;

  const needsRecovery = (userId: string, run: MockStoredRun) => {
    if (run.status === "waiting_input") {
      return (
        !!run.interrupt && Date.parse(run.interrupt.expiresAt) <= Date.now()
      );
    }
    return (
      activeStatus(run.status) &&
      (run.workerId !== workerId || !workers.has(channelKey(userId, run.id)))
    );
  };

  const readRecovered = async (userId: string) => {
    const database = await storage.read(userId);
    if (
      !database.conversations.some(
        ({ pendingAgentTurn, runs }) =>
          !!pendingAgentTurn || runs?.some((run) => needsRecovery(userId, run)),
      )
    )
      return database;

    const published: { run: MockStoredRun; events: MockRunEvent[] }[] = [];
    const recovered = await storage.update(userId, (record) => {
      for (const conversation of record.conversations) {
        migrateLegacyPause(conversation);
        for (const run of conversation.runs ?? []) {
          if (!needsRecovery(userId, run)) continue;
          const events: MockRunEvent[] = [];
          const assistant = conversation.messages.find(
            ({ id }) => id === run.assistantMessageId,
          );
          const emit = makeEmitter(run, events);
          if (run.status === "waiting_input") {
            finishRun(run, assistant, emit, "canceled");
          } else {
            finishRun(run, assistant, emit, "failed", INTERRUPTED_RUN_ERROR);
          }
          if (assistant && conversation.lastMessage?.id === assistant.id) {
            updateConversationMessages(conversation, assistant);
          }
          published.push({ run, events });
        }
      }
      return record;
    });
    for (const { run, events } of published) {
      feed.publish(channelKey(userId, run.id), events, run.status);
    }
    return recovered;
  };

  const changeRun = <Result>(
    userId: string,
    runId: string,
    action: (
      conversation: MockConversationRecord,
      run: MockStoredRun,
      emit: Emit,
    ) => Result,
  ) =>
    serialize(async () => {
      const events: MockRunEvent[] = [];
      const { result, status } = await storage.update(userId, (database) => {
        const { conversation, run } = getStoredRun(database, runId);
        const result = action(conversation, run, makeEmitter(run, events));
        return { result, status: run.status };
      });
      if (events.length)
        feed.publish(channelKey(userId, runId), events, status);
      return result;
    });

  const ownsExecution = (run: MockStoredRun) =>
    run.status === "running" && run.workerId === workerId;

  const saveExtras = async (
    userId: string,
    runId: string,
    turn: AgentTurn,
    text: string,
    startTitle: string,
  ) => {
    if (!driver.generateExtras) return;
    let extras: AgentExtras = { title: null, suggestedQuestions: [] };
    try {
      extras = await driver.generateExtras(
        {
          userInput: turn.input,
          assistantText: text,
          includeTitle: startTitle === DEFAULT_TITLE,
        },
        AbortSignal.timeout(EXTRAS_TIMEOUT_MS),
      );
    } catch {
      console.warn("本地运行辅助内容生成失败", runId);
    }
    try {
      await changeRun(userId, runId, (conversation, run) => {
        const assistant = getRunMessage(conversation, run.assistantMessageId);
        assistant.metadata = {
          ...assistant.metadata,
          suggestedQuestions: extras.suggestedQuestions,
        };
        if (
          conversation.lastMessage?.id === assistant.id &&
          extras.title &&
          !conversation.titleManuallySet &&
          conversation.title === startTitle &&
          startTitle === DEFAULT_TITLE
        ) {
          conversation.title = extras.title;
        }
      });
    } catch (error) {
      if (!(error instanceof MockRunError && error.status === 404)) {
        console.error("本地运行辅助内容写入失败", runId, error);
      }
    }
  };

  const execute = async (
    userId: string,
    readyRunId: string,
    worker: Worker,
  ) => {
    const deadlineAt = Date.now() + RUN_TIMEOUT_MS;
    const signal = AbortSignal.any([
      worker.controller.signal,
      AbortSignal.timeout(RUN_TIMEOUT_MS),
    ]);
    let pending = "";
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let writes = Promise.resolve();
    let writeError: unknown;

    const progress = (
      apply: (assistant: Message, run: MockStoredRun, emit: Emit) => void,
    ) => {
      writes = writes
        .then(async () => {
          if (writeError !== undefined) return;
          await changeRun(userId, readyRunId, (conversation, run, emit) => {
            if (ownsExecution(run))
              apply(
                getRunMessage(conversation, run.assistantMessageId),
                run,
                emit,
              );
          });
        })
        .catch((error: unknown) => {
          writeError = error;
        });
      return writes;
    };

    const flush = (replace?: true) => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!pending && !replace) return writes;
      const content = pending;
      pending = "";
      return progress((assistant, _run, emit) => {
        assistant.content = replace ? content : assistant.content + content;
        emit({ type: "text-delta", messageId: assistant.id, content, replace });
      });
    };
    worker.flush = flush;

    try {
      const claim = await changeRun(
        userId,
        readyRunId,
        (conversation, run, emit) => {
          if (run.status !== "queued" || run.workerId !== workerId) return null;
          const turn = turnFor(conversation, run);
          run.status = "running";
          const {
            id,
            conversationId,
            userMessageId,
            assistantMessageId,
            traceId,
            resume,
          } = run;
          emit({
            type: "run-start",
            runId: id,
            conversationId,
            userMessageId,
            assistantMessageId,
            traceId,
            resume: resume ? true : undefined,
          });
          if (resume) {
            const assistant = getRunMessage(conversation, assistantMessageId);
            assistant.content = "";
            emit({
              type: "text-delta",
              messageId: assistantMessageId,
              content: "",
              replace: true,
            });
          }
          return { turn, resume, title: conversation.title };
        },
      );
      if (!claim) return;
      signal.throwIfAborted();
      const result = AgentTurnResult.parse(
        await driver.execute(claim.turn, {
          signal,
          deadlineAt,
          resume: claim.resume,
          onStage: (stage) => {
            void flush();
            void progress((_assistant, run, emit) => {
              run.stage = stage;
              emit({ type: "status", stage });
            });
          },
          onTextDelta: async (delta, replace) => {
            signal.throwIfAborted();
            pending = replace ? delta : pending + delta;
            if (replace || pending.length >= TEXT_CHECKPOINT_CHARS) {
              await flush(replace);
            } else if (!flushTimer && pending) {
              flushTimer = setTimeout(() => {
                void flush();
              }, TEXT_CHECKPOINT_MS);
            }
            if (writeError !== undefined) throw writeError;
          },
        }),
      );
      await flush();
      if (writeError !== undefined) throw writeError;
      signal.throwIfAborted();

      const completed = await changeRun(
        userId,
        readyRunId,
        (conversation, run, emit) => {
          if (!ownsExecution(run)) return false;
          const assistant = getRunMessage(conversation, run.assistantMessageId);
          if (result.status === "succeeded" && result.graph) {
            let graphError: RunError | undefined;
            if (run.graphReferenceMessageId) {
              graphError = {
                code: ERROR_CODES.AGENT_GRAPH_REFERENCE_READ_ONLY,
                message: "历史图引用仅用于解释，请移除引用后重新发送修改请求。",
              };
            } else if (conversation.draftVersion !== claim.turn.draftVersion) {
              graphError = {
                code: ERROR_CODES.DRAFT_VERSION_CONFLICT,
                message: "画布已有更新，请基于当前画布重试。",
              };
            }
            if (graphError) {
              finishRun(run, assistant, emit, "failed", graphError);
              updateConversationMessages(conversation, assistant);
              return false;
            }
          }
          if (assistant.content !== result.text) {
            assistant.content = result.text;
            emit({
              type: "text-delta",
              messageId: assistant.id,
              content: result.text,
              replace: true,
            });
          }
          conversation.agentConstraints = result.constraints;
          updateConversationMessages(conversation, assistant);
          if (result.status === "waiting_input") {
            const { interrupt, card } = pauseRun(
              run,
              assistant,
              result,
              driver.clarificationOptions?.(result.checkpoint) ?? [],
            );
            emit({ type: "constraint-card", messageId: assistant.id, card });
            emit({ type: "interrupt", ...interrupt });
            return false;
          }
          assistant.metadata = {
            ...assistant.metadata,
            citations: result.citations,
            suggestedQuestions: driver.generateExtras ? undefined : [],
          };
          if (result.citations.length)
            emit({ type: "citation", sources: result.citations });
          if (result.graph) {
            assistant.graphSnapshot = result.graph;
            conversation.draftGraph = result.graph;
            conversation.draftVersion += 1;
            emit({ type: "graph", graph: result.graph, replace: true });
          }
          finishRun(run, assistant, emit, "succeeded");
          return true;
        },
      );
      if (completed && result.status === "succeeded") {
        void saveExtras(
          userId,
          readyRunId,
          claim.turn,
          result.text,
          claim.title,
        );
      }
    } catch (error) {
      await flush();
      try {
        await changeRun(userId, readyRunId, (conversation, run, emit) => {
          if (
            !ownsExecution(run) &&
            !(run.status === "queued" && run.workerId === workerId)
          )
            return;
          const assistant = conversation.messages.find(
            ({ id }) => id === run.assistantMessageId,
          );
          finishRun(run, assistant, emit, "failed", {
            code:
              error instanceof MockRunError
                ? error.code
                : ERROR_CODES.SERVICE_UNAVAILABLE,
            message:
              error instanceof MockRunError
                ? error.message
                : "生成暂时失败，请重新发送请求。",
          });
          if (assistant) updateConversationMessages(conversation, assistant);
        });
      } catch (persistenceError) {
        if (!(
          persistenceError instanceof MockRunError &&
          persistenceError.status === 404
        )) {
          console.error("本地运行状态写入失败", readyRunId, persistenceError);
        }
      }
    } finally {
      const key = channelKey(userId, readyRunId);
      if (workers.get(key) === worker) workers.delete(key);
    }
  };

  const accept = (
    userId: string,
    conversationId: string,
    input: MockSendMessageInput,
    idempotencyKey: string,
  ) =>
    serialize(async () => {
      await readRecovered(userId);
      const attachments = [...new Set(input.attachments ?? [])].sort();
      const { graphReferenceMessageId } = input;
      const hash = digest({
        content: input.content,
        interruptId: input.interruptId,
        attachments,
        graphReferenceMessageId,
      });
      const events: MockRunEvent[] = [];
      const { run, start } = await storage.update(userId, (database) => {
        const conversation = getRunConversation(database, conversationId);
        const runs = conversation.runs ?? [];
        const replay = runs.find(({ receipts }) =>
          receipts.some(({ key }) => key === idempotencyKey),
        );
        if (replay) {
          if (
            replay.receipts.find(({ key }) => key === idempotencyKey)?.hash !==
            hash
          ) {
            throw runError(
              422,
              ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
              "该请求键已用于其他消息",
            );
          }
          return { run: replay, start: false };
        }
        if (
          attachments.some(
            (id) =>
              !database.files.some(
                (file) =>
                  file.id === id && file.projectId === conversation.projectId,
              ),
          )
        )
          throw runError(
            404,
            ERROR_CODES.FILE_NOT_FOUND,
            "附件不属于当前项目或已删除",
          );

        const active = runs.find(({ status }) => activeStatus(status));
        const previousAnswer =
          input.interruptId &&
          runs.find(({ answeredInterrupts }) =>
            answeredInterrupts.some(({ id }) => id === input.interruptId),
          );
        if (previousAnswer) {
          const receipt = previousAnswer.answeredInterrupts.find(
            ({ id }) => id === input.interruptId,
          );
          if (
            attachments.length ||
            receipt?.answer !== digest(input.content) ||
            receipt.graphReferenceMessageId !== graphReferenceMessageId
          ) {
            throw runError(
              409,
              ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
              "该澄清已提交过其他回答",
            );
          }
          previousAnswer.receipts.push({ key: idempotencyKey, hash });
          return { run: previousAnswer, start: false };
        }
        if (
          input.interruptId &&
          active?.interrupt?.interruptId !== input.interruptId
        ) {
          throw runError(
            409,
            ERROR_CODES.CARD_EXPIRED,
            "这张澄清卡片已失效，请刷新会话",
          );
        }
        if (graphReferenceMessageId !== undefined) {
          getReferencedGraph(conversation, graphReferenceMessageId);
        }
        if (active) {
          if (
            active.status !== "waiting_input" ||
            !active.interrupt ||
            !active.checkpoint ||
            attachments.length
          ) {
            throw runError(
              409,
              ERROR_CODES.CONVERSATION_BUSY,
              "会话已有运行中的任务",
            );
          }
          if (
            active.graphReferenceMessageId !== undefined &&
            graphReferenceMessageId !== undefined &&
            active.graphReferenceMessageId !== graphReferenceMessageId
          ) {
            throw runError(
              409,
              ERROR_CODES.VALIDATION_FAILED,
              "这次任务已引用一张历史图。要改选其他历史图，请取消当前任务后重新发送。",
            );
          }
          const answer = makeRunMessage("user", input.content);
          const assistant = getRunMessage(
            conversation,
            active.assistantMessageId,
          );
          assistant.createdAt = answer.createdAt;
          conversation.messages = conversation.messages
            .filter(({ id }) => id !== assistant.id)
            .concat(answer, assistant);
          updateConversationMessages(conversation, assistant);
          active.graphReferenceMessageId ??= graphReferenceMessageId;
          active.answeredInterrupts.push({
            id: active.interrupt.interruptId,
            answer: digest(input.content),
            graphReferenceMessageId,
          });
          const card = assistant.metadata?.card;
          if (card) {
            card.status = "answered";
            card.answer = {
              values: [input.content],
              isCustom: !card.options.some(
                ({ value }) => value === input.content,
              ),
            };
            card.answeredAt = answer.createdAt;
            makeEmitter(
              active,
              events,
            )({
              type: "card-updated",
              cardId: card.id,
              status: card.status,
              answer: card.answer,
            });
          }
          active.resume = {
            checkpoint: active.checkpoint,
            answer: input.content,
          };
          active.responseMessageId = answer.id;
          active.status = "queued";
          active.workerId = workerId;
          active.receipts.push({ key: idempotencyKey, hash });
          delete active.interrupt;
          delete active.checkpoint;
          return { run: active, start: true };
        }

        const user = makeRunMessage("user", input.content);
        const assistant = makeRunMessage("assistant", "");
        const newRun = makeRun(
          conversation,
          user,
          assistant,
          attachments,
          workerId,
          graphReferenceMessageId,
        );
        newRun.receipts.push({ key: idempotencyKey, hash });
        conversation.messages.push(user, assistant);
        updateConversationMessages(conversation, assistant);
        (conversation.runs ??= []).push(newRun);
        return { run: newRun, start: true };
      });
      const key = channelKey(userId, run.id);
      if (events.length) feed.publish(key, events, run.status);
      if (start) {
        const worker = { controller: new AbortController() };
        workers.set(key, worker);
        void execute(userId, run.id, worker);
      }
      return acceptedRun(run);
    });

  const active = (
    userId: string,
    conversationId: string,
  ): Promise<MockActiveRun> =>
    serialize(async () => {
      const database = await readRecovered(userId);
      const conversation = getRunConversation(database, conversationId);
      const running = conversation.runs?.find(({ status }) =>
        activeStatus(status),
      );
      const latest = conversation.runs?.at(-1);
      return {
        run: running ? acceptedRun(running) : null,
        latest: latest ? acceptedRun(latest) : null,
      };
    });

  const snapshot = (userId: string, runId: string) =>
    serialize(async () => {
      const { conversation, run } = getStoredRun(
        await readRecovered(userId),
        runId,
      );
      return snapshotRun(conversation, run);
    });

  const stream = (
    userId: string,
    runId: string,
    cursor?: number,
    signal?: AbortSignal,
  ) =>
    serialize(async () => {
      const { conversation, run } = getStoredRun(
        await readRecovered(userId),
        runId,
      );
      if (cursor !== undefined && cursor > run.cursor) {
        throw runError(
          409,
          ERROR_CODES.RUN_NOT_RESUMABLE,
          "事件游标超出运行记录",
        );
      }
      return feed.open(
        channelKey(userId, runId),
        snapshotRun(conversation, run),
        run.cursor,
        cursor,
        signal,
      );
    });

  const cancel = async (
    userId: string,
    runId: string,
  ): Promise<CancelResult> => {
    const key = channelKey(userId, runId);
    await workers.get(key)?.flush?.();
    const status = await changeRun(userId, runId, (conversation, run, emit) => {
      if (!activeStatus(run.status)) return run.status;
      const assistant = getRunMessage(conversation, run.assistantMessageId);
      if (needsRecovery(userId, run) && run.status !== "waiting_input") {
        finishRun(run, assistant, emit, "failed", INTERRUPTED_RUN_ERROR);
      } else {
        finishRun(run, assistant, emit, "canceled");
      }
      updateConversationMessages(conversation, assistant);
      return run.status;
    });
    if (status === "canceled") workers.get(key)?.controller.abort();
    return { runId, status };
  };

  return { accept, active, snapshot, stream, cancel };
};
