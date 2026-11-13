"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  AnswerCardInput,
  Conversation,
  ForkInput,
  ForkResult,
  GraphInput,
  Message,
  MessageMetadata,
  Page,
  ProjectNode,
  RunAccepted,
  RunStage,
  SaveDraftInput,
  SaveDraftResult,
  SseFrame,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import {
  conversationQueryKey,
  messagesQueryKey,
  projectQueryKey,
} from "@/lib/query-keys";
import { connectRunStream } from "@/lib/sse-client";

type StreamState = {
  runId: string | null;
  /** 当前 run 正在写入的 assistant 消息；状态提示只挂在这条消息下。 */
  assistantMessageId: string | null;
  isStreaming: boolean;
  stage: RunStage | null;
};

const now = (): string => new Date().toISOString();

const activeRunKey = (conversationId: string): string =>
  `archflow:active-run:${conversationId}`;

const updateMessage = (
  page: Page<Message> | undefined,
  messageId: string,
  updater: (message: Message) => Message,
): Page<Message> | undefined =>
  page
    ? {
        ...page,
        items: page.items.map((message) =>
          message.id === messageId ? updater(message) : message,
        ),
      }
    : page;

const ensureMessage = (
  page: Page<Message> | undefined,
  messageId: string,
  factory: () => Message,
): Page<Message> | undefined => {
  if (!page) {
    return page;
  }

  return page.items.some((message) => message.id === messageId)
    ? page
    : { ...page, items: [...page.items, factory()] };
};

export const useRunStream = (conversationId: string | null) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const finishedRef = useRef(false);
  const [state, setState] = useState<StreamState>({
    runId: null,
    assistantMessageId: null,
    isStreaming: false,
    stage: null,
  });

  const messagesKey = conversationId
    ? messagesQueryKey(conversationId)
    : messagesQueryKey("none");
  const conversationKey = conversationId
    ? conversationQueryKey(conversationId)
    : conversationQueryKey("none");

  const clearActiveRun = useCallback(() => {
    if (conversationId && typeof window !== "undefined") {
      window.sessionStorage.removeItem(activeRunKey(conversationId));
    }
  }, [conversationId]);

  const patchMessage = useCallback(
    (messageId: string, updater: (message: Message) => Message) => {
      queryClient.setQueryData<Page<Message>>(messagesKey, (current) =>
        updateMessage(current, messageId, updater),
      );
    },
    [messagesKey, queryClient],
  );

  const patchMetadata = useCallback(
    (messageId: string, patch: Partial<MessageMetadata>) => {
      patchMessage(messageId, (message) => ({
        ...message,
        metadata: { ...(message.metadata ?? {}), ...patch },
      }));
    },
    [patchMessage],
  );

  const finish = useCallback(
    (conversationIdToRefresh: string | null) => {
      if (finishedRef.current) {
        return;
      }

      finishedRef.current = true;
      setState((current) => ({
        ...current,
        isStreaming: false,
        stage: null,
      }));

      if (conversationIdToRefresh) {

        void queryClient.invalidateQueries({
          queryKey: messagesQueryKey(conversationIdToRefresh),
        });
        void queryClient.invalidateQueries({
          queryKey: conversationQueryKey(conversationIdToRefresh),
        });
      }

      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
    },
    [queryClient],
  );

  const handleFrame = useCallback(
    (frame: SseFrame, assistantMessageId: string) => {
      switch (frame.type) {
        case "run-start": {
          setState((current) => ({
            ...current,
            runId: frame.runId,
            assistantMessageId: frame.assistantMessageId,
          }));
          queryClient.setQueryData<Page<Message>>(messagesKey, (current) =>
            ensureMessage(current, frame.assistantMessageId, () => ({
              id: frame.assistantMessageId,
              role: "assistant",
              content: "",
              graphSnapshot: null,
              metadata: null,
              createdAt: now(),
            })),
          );
          return;
        }
        case "status": {
          setState((current) => ({ ...current, stage: frame.stage }));
          return;
        }
        case "text-delta": {
          patchMessage(frame.messageId, (message) => ({
            ...message,
            content: frame.replace
              ? frame.content
              : `${message.content}${frame.content}`,
          }));
          return;
        }
        case "graph": {
          queryClient.setQueryData<Conversation>(
            conversationKey,
            (current) =>
              current
                ? {
                    ...current,
                    draftGraph: frame.graph,
                    draftVersion: current.draftVersion + 1,
                  }
                : current,
          );
          patchMessage(assistantMessageId, (message) => ({
            ...message,
            graphSnapshot: frame.graph,
          }));
          return;
        }
        case "citation": {
          patchMetadata(assistantMessageId, { citations: frame.sources });
          return;
        }
        case "constraint-card": {
          patchMetadata(frame.messageId, { card: frame.card });
          return;
        }
        case "card-updated": {
          queryClient.setQueryData<Page<Message>>(messagesKey, (current) =>
            current
              ? {
                  ...current,
                  items: current.items.map((message) =>
                    message.metadata?.card?.id === frame.cardId
                      ? {
                          ...message,
                          metadata: {
                            ...(message.metadata ?? {}),
                            card: message.metadata?.card
                              ? {
                                  ...message.metadata.card,
                                  status: frame.status,
                                  answer: frame.answer,
                                  answeredAt: now(),
                                }
                              : undefined,
                          },
                        }
                      : message,
                  ),
                }
              : current,
          );
          return;
        }
        case "usage": {
          patchMetadata(assistantMessageId, {
            usage: {
              inputTokens: frame.inputTokens,
              outputTokens: frame.outputTokens,
              model: frame.model,
              latencyMs: frame.latencyMs,
            },
          });
          return;
        }
        case "title": {
          queryClient.setQueryData<Conversation>(
            conversationQueryKey(frame.conversationId),
            (current) =>
              current ? { ...current, title: frame.title } : current,
          );
          queryClient.setQueryData<Page<ProjectNode>>(
            projectQueryKey,
            (current) =>
              current
                ? {
                    ...current,
                    items: current.items.map((project) => ({
                      ...project,
                      conversations: project.conversations.map((conversation) =>
                        conversation.id === frame.conversationId
                          ? { ...conversation, title: frame.title }
                          : conversation,
                      ),
                    })),
                  }
                : current,
          );
          return;
        }
        case "error": {
          toast.error(frame.message);
          return;
        }
        case "done": {
          clearActiveRun();
          finish(conversationId);
          return;
        }
        case "interrupt": {
          clearActiveRun();
          finish(conversationId);
          return;
        }
        default:
          return;
      }
    },
    [
      clearActiveRun,
      conversationId,
      conversationKey,
      finish,
      messagesKey,
      patchMessage,
      patchMetadata,
      queryClient,
    ],
  );

  const consume = useCallback(
    async (accepted: RunAccepted) => {
      if (!conversationId) {
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      finishedRef.current = false;

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(
          activeRunKey(conversationId),
          JSON.stringify(accepted),
        );
      }
      setState({
        runId: accepted.runId,
        assistantMessageId: accepted.assistantMessageId,
        isStreaming: true,
        stage: null,
      });
      queryClient.setQueryData<Page<Message>>(messagesKey, (current) =>
        ensureMessage(current, accepted.assistantMessageId, () => ({
          id: accepted.assistantMessageId,
          role: "assistant",
          content: "",
          graphSnapshot: null,
          metadata: null,
          createdAt: now(),
        })),
      );

      try {
        await connectRunStream({
          runId: accepted.runId,
          streamUrl: accepted.streamUrl,
          signal: controller.signal,
          onFrame: (frame) => {
            /** 被新 run 替换后，旧连接迟到的帧直接丢弃。 */
            if (abortRef.current === controller) {
              handleFrame(frame, accepted.assistantMessageId);
            }
          },
          onError: (error) => {
            if (abortRef.current === controller && !controller.signal.aborted) {
              toast.error(`生成中断：${error.message}`);
            }
          },
          onClose: () => {
            if (abortRef.current === controller) {
              finish(conversationId);
            }
          },
        });
      } catch (error) {
        if (abortRef.current === controller && !controller.signal.aborted) {
          const message =
            error instanceof Error ? error.message : "SSE 连接失败";
          toast.error(message);
        }
      } finally {
        /** 旧连接结束时不能把新 run 的 finishedRef 置为 true。 */
        if (abortRef.current === controller) {
          finish(conversationId);
        }
      }
    },
    [conversationId, finish, handleFrame, messagesKey, queryClient],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!conversationId) {
        throw new Error("请先选择会话");
      }

      const accepted = await requestApi<RunAccepted>(
        `/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ content }),
        },
      );

      queryClient.setQueryData<Page<Message>>(messagesKey, (current) =>
        ensureMessage(current, accepted.userMessageId, () => ({
          id: accepted.userMessageId,
          role: "user",
          content,
          graphSnapshot: null,
          metadata: null,
          createdAt: now(),
        })),
      );

      await consume(accepted);
    },
    [consume, conversationId, messagesKey, queryClient],
  );

  const answerCard = useCallback(
    async (messageId: string, input: AnswerCardInput) => {
      if (!conversationId) {
        return;
      }

      const accepted = await requestApi<RunAccepted>(
        `/conversations/${conversationId}/messages/${messageId}/answer`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );

      const cached = queryClient.getQueryData<Page<Message>>(messagesKey);
      const answeredCard = cached?.items.find(
        (message) => message.id === messageId,
      )?.metadata?.card;
      const fallbackField = answeredCard?.steps?.[0]?.id ?? "value";
      const answers =
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
        return;
      }

      const firstAnswer = Object.values(answers)[0] ?? null;
      const labelParts = Object.entries(answers).map(([field, answer]) => {
        const step = answeredCard?.steps?.find((item) => item.id === field);
        const options = step?.options ?? answeredCard?.options ?? [];

        return answer.values
          .map(
            (value) =>
              options.find((option) => option.value === value)?.label ?? value,
          )
          .join("、");
      });

      /** 先乐观置灰，流结束后由消息列表校准。 */
      queryClient.setQueryData<Page<Message>>(messagesKey, (current) => {
        if (!current) {
          return current;
        }

        const items = current.items.map((message) =>
          message.id === messageId && message.metadata?.card
            ? {
                ...message,
                metadata: {
                  ...(message.metadata ?? {}),
                  card: {
                    ...message.metadata.card,
                    status: "answered" as const,
                    answer: firstAnswer,
                    answers,
                    answeredAt: now(),
                  },
                },
              }
            : message,
        );

        /** 把「用户回答」先放进 cache，保证新 assistant 气泡排在它后面。 */
        const withAnswer = items.some(
          (message) => message.id === accepted.userMessageId,
        )
          ? items
          : [
              ...items,
              {
                id: accepted.userMessageId,
                role: "user" as const,
                content: `已选择：${labelParts.join("；")}`,
                graphSnapshot: null,
                metadata: null,
                createdAt: now(),
              },
            ];

        return { ...current, items: withAnswer };
      });

      await consume(accepted);
    },
    [consume, conversationId, messagesKey, queryClient],
  );

  const cancel = useCallback(async () => {
    if (!state.runId) {
      return;
    }

    try {
      await requestApi(`/runs/${state.runId}/cancel`, { method: "POST" });
    } finally {
      abortRef.current?.abort();
      clearActiveRun();
      finish(conversationId);
    }
  }, [clearActiveRun, conversationId, finish, state.runId]);

  const saveDraft = useCallback(
    async (graph: GraphInput) => {
      if (!conversationId) {
        return;
      }

      const conversation = queryClient.getQueryData<Conversation>(
        conversationKey,
      );

      if (!conversation) {
        return;
      }

      try {
        const result = await requestApi<SaveDraftResult>(
          `/conversations/${conversationId}/draft`,
          {
            method: "PUT",
            body: JSON.stringify({
              graph,
              baseVersion: conversation.draftVersion,
            } satisfies SaveDraftInput),
          },
        );

        queryClient.setQueryData<Conversation>(conversationKey, (current) =>
          current
            ? {
                ...current,
                draftGraph: graph,
                draftVersion: result.draftVersion,
                updatedAt: result.updatedAt,
              }
            : current,
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "草稿保存失败",
        );
      }
    },
    [conversationId, conversationKey, queryClient],
  );

  const forkMessage = useCallback(
    async (sourceMessageId: string) => {
      if (!conversationId) {
        return;
      }

      const result = await requestApi<ForkResult>(
        `/conversations/${conversationId}/fork`,
        {
          method: "POST",
          body: JSON.stringify({ sourceMessageId } satisfies ForkInput),
        },
      );

      await queryClient.invalidateQueries({ queryKey: projectQueryKey });
      toast.success("已创建新分支");
      router.push(`/workspace?conversationId=${result.id}`);
    },
    [conversationId, queryClient, router],
  );

  /** 刷新页面时若仍有活跃 run，自动接回同一 streamUrl。 */
  const consumeRef = useRef(consume);
  consumeRef.current = consume;
  const resumedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId || resumedRef.current === conversationId) {
      return;
    }

    resumedRef.current = conversationId;
    const raw = window.sessionStorage.getItem(activeRunKey(conversationId));

    if (!raw) {
      return;
    }

    try {
      const accepted = JSON.parse(raw) as RunAccepted;
      void consumeRef.current(accepted);
    } catch {
      window.sessionStorage.removeItem(activeRunKey(conversationId));
    }
  }, [conversationId]);

  return {
    ...state,
    sendMessage,
    answerCard,
    cancel,
    saveDraft,
    forkMessage,
  };
};
