"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import type { Message, Page, ProjectNode, RunStage } from "@arch-flow/shared";
import { BrandMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { projectQueryKey } from "@/preview/lib/query-keys";
import { isRunInProgress } from "@/preview/lib/run-view";
import { useConversation } from "@/preview/hooks/use-conversation";
import { useConversationRun } from "@/preview/hooks/use-conversation-run";
import { useMessages } from "@/preview/hooks/use-messages";
import { DEFAULT_PROJECT_NAME, useCreateProject } from "@/preview/hooks/use-projects";
import {
  prepareChatSubmission,
  type ChatSubmission,
} from "@/preview/hooks/use-send-message";
import { ChatHeader } from "./chat-header";
import { MessageGraphDialog } from "./message-graph-dialog";

/** 输入框默认 2 行（48px），最多撑到 4 行（96px）后出现滚动条。 */
const DRAFT_MIN_HEIGHT = 48;
const DRAFT_MAX_HEIGHT = 96;
const SCROLL_FOLLOW_DISTANCE = 80;
const STAGE_LABELS: Record<RunStage, string> = {
  thinking: "正在理解你的请求…",
  searching_knowledge: "正在查项目资料…",
  drafting_graph: "正在准备架构图…",
  finalizing: "正在保存结果…",
};

type GraphReference = {
  conversationId: string;
  messageId: Message["id"];
  label: string;
};

const showLiveMessage = (saved: Message[], live?: Message) => {
  if (!live || !(live.content || live.metadata || live.graphSnapshot))
    return saved;
  if (!saved.some(({ id }) => live.id === id)) return [...saved, live];
  return saved.map((message) =>
    message.id === live.id
      ? {
          ...live,
          createdAt: message.createdAt,
          metadata: { ...message.metadata, ...live.metadata },
        }
      : message,
  );
};

const MessageTime = ({ createdAt }: { createdAt: string }) => (
  <p className="mt-1 text-[10px] text-muted-foreground/70">
    {createdAt.slice(11, 16)}
  </p>
);

export const ChatPanel = ({
  conversationId,
}: {
  conversationId: string | null;
}) => {
  const [draft, setDraft] = useState("");
  const [graphReference, setGraphReference] = useState<GraphReference>();
  const selectedGraph =
    graphReference?.conversationId === conversationId
      ? graphReference
      : undefined;
  const activeConversation = useRef(conversationId);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyAnchor = useRef<{ row: Element; top: number } | null>(null);
  const followBottom = useRef(true);
  const lastSubmission = useRef<ChatSubmission | null>(null);
  const sending = useRef(false);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const conversation = useConversation(conversationId);
  const {
    latest: messagesQuery,
    messages: savedMessages,
    canLoadEarlier,
    historyStatus,
    loadEarlier,
  } = useMessages(conversationId);
  const generation = useConversationRun(conversationId);
  const createProject = useCreateProject();
  const sendMessage = generation.send;
  const liveMessage =
    generation.phase === "settled" && messagesQuery.data
      ? undefined
      : generation.view?.message;
  const messages = showLiveMessage(savedMessages, liveMessage);
  const runMessage = messages.find(
    ({ id }) => id === generation.handle?.assistantMessageId,
  );
  const suggestionMessage = generation.handle ? runMessage : messages.at(-1);
  const suggestions =
    !generation.handle || generation.status === "succeeded"
      ? (suggestionMessage?.metadata?.suggestedQuestions ?? [])
      : [];
  const isLoading = conversation.isPending || messagesQuery.isPending;
  const isError = conversation.isLoadingError || messagesQuery.isLoadingError;
  const error = conversation.error ?? messagesQuery.error;
  const isRunning = isRunInProgress(generation.status);
  const runCard = runMessage?.metadata?.card;
  const waitingCard =
    generation.status === "waiting_input" && runCard?.status === "pending"
      ? runCard
      : undefined;
  const isBusy =
    sendMessage.isPending ||
    createProject.isPending ||
    generation.isLoading ||
    generation.cancel.isPending;
  const canSubmit =
    !isBusy &&
    !isRunning &&
    (generation.status !== "waiting_input" || Boolean(waitingCard));

  useEffect(() => {
    activeConversation.current = conversationId;
    followBottom.current = true;
    setGraphReference((current) =>
      current?.conversationId === conversationId ? current : undefined,
    );
  }, [conversationId]);

  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    if (!anchor) return;

    historyAnchor.current = null;
    const scroll = scrollRef.current;
    if (scroll?.contains(anchor.row)) {
      scroll.scrollTop += anchor.row.getBoundingClientRect().top - anchor.top;
    }
  });

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll && followBottom.current) scroll.scrollTop = scroll.scrollHeight;
  });

  useEffect(() => {
    const textarea = draftRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, DRAFT_MIN_HEIGHT),
      DRAFT_MAX_HEIGHT,
    )}px`;
  }, [draft]);

  /**
   * 底部占位盒保留输入框的 2 行基础高度及其他控件；
   * 输入框展开时绝对定位向上溢出，不再挤压上方消息区。
   */
  useEffect(() => {
    const composer = composerRef.current;

    if (!composer) {
      return;
    }

    const syncPlaceholder = () => {
      const textarea = draftRef.current;

      const draftOverflow = textarea
        ? Math.max(0, textarea.offsetHeight - DRAFT_MIN_HEIGHT)
        : 0;

      setComposerHeight(composer.offsetHeight - draftOverflow);
    };

    syncPlaceholder();
    const observer = new ResizeObserver(syncPlaceholder);
    observer.observe(composer);

    return () => observer.disconnect();
  }, []);

  const handleLoadEarlier = () => {
    void loadEarlier(() => {
      const row = scrollRef.current?.querySelector("[data-message-id]");
      if (!row) return;

      followBottom.current = false;
      historyAnchor.current = { row, top: row.getBoundingClientRect().top };
    });
  };

  const toggleGraphReference = (message: Message) => {
    if (!conversationId || !canSubmit || sending.current) return;

    const time = message.createdAt.slice(11, 19);
    const excerpt = message.content.trim().split(/\r?\n/, 1).at(0);
    const label = excerpt ? `${time} ${excerpt}` : time;
    setGraphReference((current) =>
      current?.conversationId === conversationId &&
      current.messageId === message.id
        ? undefined
        : { conversationId, messageId: message.id, label },
    );
    draftRef.current?.focus();
  };

  const submit = (targetId: string, content: string, interruptId?: string) => {
    if (sending.current) return;
    const variables = prepareChatSubmission(
      { conversationId: targetId, content, interruptId },
      lastSubmission.current,
      selectedGraph,
    );
    lastSubmission.current = variables;
    followBottom.current = true;
    sending.current = true;
    setDraft("");
    const send = async () => {
      try {
        await sendMessage.mutateAsync(variables);
        lastSubmission.current = null;
        setGraphReference((current) =>
          current === selectedGraph ? undefined : current,
        );
      } catch (error) {
        if (
          activeConversation.current === targetId ||
          (conversationId === null && activeConversation.current === null)
        ) {
          setDraft((current) => current || content);
          toast.error(
            error instanceof Error ? error.message : "发送失败，请重试。",
          );
        }
      } finally {
        sending.current = false;
      }
    };
    void send();
  };

  const handleSend = () => {
    const content = draft.trim();
    if (!content || !canSubmit) return;

    if (conversationId) {
      submit(conversationId, content, waitingCard?.id);
      return;
    }

    const cachedProjects =
      queryClient.getQueryData<Page<ProjectNode>>(projectQueryKey);

    if (cachedProjects === undefined) {
      toast.info("项目数据加载中，请稍后再试");
      return;
    }

    if (cachedProjects.items.length > 0) {
      toast.info("请先从左侧选择一个会话");
      return;
    }

    /** 边界：项目数为 0 时，发送会话消息前先创建项目与首个会话。 */
    setDraft("");
    createProject.mutate(
      { name: DEFAULT_PROJECT_NAME },
      {
        onSuccess: (project) => {
          const nextConversationId = project.lastActiveConversationId;

          if (!nextConversationId) {
            toast.error("项目已创建，但没有可用的会话");
            return;
          }

          router.replace(`/workspace?conversationId=${nextConversationId}`);
          submit(nextConversationId, content);
        },
        onError: (error) => {
          setDraft(content);
          toast.error(error.message);
        },
      },
    );
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-background">
      <ChatHeader conversation={conversation.data ?? null} />

      <div
        ref={scrollRef}
        className="arch-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-6"
        onScroll={({ currentTarget }) => {
          followBottom.current =
            currentTarget.scrollHeight -
              currentTarget.scrollTop -
              currentTarget.clientHeight <
            SCROLL_FOLLOW_DISTANCE;
        }}
      >
        {!conversationId && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <BrandMark className="size-8 opacity-60" />
            <p className="mt-4 text-sm font-medium">还没有选择会话</p>
            <p className="mt-1 max-w-[240px] text-[11px] leading-5 text-muted-foreground">
              从左侧项目树选择一个会话，或新建项目开始。
            </p>
          </div>
        )}

        {conversationId && isLoading && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
            正在加载会话…
          </div>
        )}

        {conversationId && isError && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-[11px] text-muted-foreground">
              会话加载失败：{error?.message ?? "未知错误"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void conversation.refetch();
                void messagesQuery.refetch();
              }}
            >
              重试
            </Button>
          </div>
        )}

        {conversation.data &&
          !isLoading &&
          !isError &&
          messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <BrandMark className="size-8 opacity-60" />
              <p className="mt-4 text-sm font-medium">从一个约束开始</p>
              <p className="mt-1 max-w-[280px] text-[11px] leading-5 text-muted-foreground">
                例如：团队 3 人、预算有限、需要在单机部署。描述你的场景，Agent
                会追问约束并生成架构。
              </p>
            </div>
          )}

        {(canLoadEarlier || historyStatus === "loaded") && (
          <div className="flex flex-col items-center gap-2">
            {canLoadEarlier ? (
              <Button
                variant="outline"
                size="sm"
                aria-disabled={historyStatus === "loading"}
                aria-busy={historyStatus === "loading"}
                onClick={handleLoadEarlier}
              >
                {historyStatus === "loading" && (
                  <Loader2
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden
                  />
                )}
                加载更早的消息
              </Button>
            ) : (
              <p role="status" className="text-xs text-muted-foreground">
                已加载全部消息
              </p>
            )}
            {historyStatus === "error" && (
              <p role="alert" className="text-xs text-muted-foreground">
                更早的消息加载失败，请重试。
              </p>
            )}
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              data-message-id={message.id}
              className="mt-6 flex flex-col items-end"
            >
              <div className="max-w-[88%] rounded-xl rounded-tr-sm bg-secondary px-4 py-3 text-[13px] leading-6 text-secondary-foreground">
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
              <MessageTime createdAt={message.createdAt} />
            </div>
          ) : (
            <div
              key={message.id}
              data-message-id={message.id}
              className="mt-6 flex items-start gap-3"
            >
              <BrandMark className="mt-0.5 size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                {message.content &&
                  message.content !== message.metadata?.card?.title && (
                    <p className="whitespace-pre-wrap text-[13px] leading-6">
                      {message.content}
                    </p>
                  )}
                {message.metadata?.card && (
                  <div className="mt-2 flex flex-col items-start gap-2 rounded-md border border-border p-3">
                    <p className="text-sm">{message.metadata.card.title}</p>
                    {message.metadata.card.status === "answered" ? (
                      <p className="text-xs text-muted-foreground">
                        已回答 ·{" "}
                        {message.metadata.card.answer?.values.join("、")}
                      </p>
                    ) : message.metadata.card.status === "pending" &&
                      waitingCard?.id === message.metadata.card.id ? (
                      <div className="flex flex-wrap gap-2">
                        {waitingCard.options.map(({ value, label }) => (
                          <Button
                            key={value}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!canSubmit}
                            onClick={() => {
                              if (conversationId)
                                submit(conversationId, value, waitingCard.id);
                            }}
                          >
                            {label}
                          </Button>
                        ))}
                        {waitingCard.options.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            在下方输入你的回答。
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
                {message.graphSnapshot && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <MessageGraphDialog graph={message.graphSnapshot} />
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        selectedGraph?.messageId === message.id
                          ? "secondary"
                          : "outline"
                      }
                      aria-pressed={selectedGraph?.messageId === message.id}
                      disabled={!conversationId || !canSubmit}
                      onClick={() => toggleGraphReference(message)}
                    >
                      用这张图提问
                    </Button>
                  </div>
                )}
                <MessageTime createdAt={message.createdAt} />
              </div>
            </div>
          ),
        )}

        {(sendMessage.isPending || isRunning) &&
          generation.phase !== "unavailable" && (
            <p
              role="status"
              className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" />
              {generation.phase === "reconnecting" ||
              generation.phase === "polling"
                ? "正在恢复连接…"
                : generation.view?.stage
                  ? STAGE_LABELS[generation.view.stage]
                  : "正在处理消息…"}
            </p>
          )}

        {generation.phase === "unavailable" || generation.error ? (
          <div
            className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"
            role="status"
          >
            暂时无法同步对话。
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={generation.retry}
            >
              重连
            </Button>
          </div>
        ) : generation.status === "failed" ||
          generation.status === "canceled" ? (
          <p role="status" className="mt-4 text-xs text-muted-foreground">
            {generation.status === "canceled"
              ? "已停止生成"
              : (generation.view?.error ?? "生成失败，请重试。")}
          </p>
        ) : null}

        {suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="推荐问题">
            {suggestions.map((question) => (
              <Button
                key={question}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(question);
                  draftRef.current?.focus();
                }}
              >
                {question}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div
        className="relative shrink-0"
        style={composerHeight === null ? undefined : { height: composerHeight }}
      >
        <div
          ref={composerRef}
          className={cn(
            "z-10 border-border bg-background p-4 pb-0",
            composerHeight !== null && "absolute inset-x-0 bottom-0",
          )}
        >
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="flex" aria-live="polite">
              {selectedGraph && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mb-2 max-w-full"
                  aria-label="移除历史图引用"
                  title={selectedGraph.label}
                  disabled={sendMessage.isPending}
                  onClick={() => {
                    if (sending.current) return;
                    setGraphReference(undefined);
                    draftRef.current?.focus();
                  }}
                >
                  <span className="truncate">
                    引用历史图 · {selectedGraph.label}
                  </span>
                  <X
                    size={14}
                    className="shrink-0"
                    data-icon="inline-end"
                    aria-hidden
                  />
                </Button>
              )}
            </div>
            <textarea
              ref={draftRef}
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="描述你的技术约束或回答问题..."
              className="arch-scrollbar w-full resize-none overflow-y-auto bg-transparent text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {generation.handle &&
                (isRunning || generation.status === "waiting_input") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={generation.cancel.isPending}
                    onClick={() => {
                      if (!generation.handle) return;
                      generation.cancel.mutate(generation.handle.runId, {
                        onError: (error) => toast.error(error.message),
                      });
                    }}
                  >
                    <Square data-icon="inline-start" />
                    停止生成
                  </Button>
                )}
              <button
                type="button"
                aria-label="发送消息"
                onClick={handleSend}
                disabled={!draft.trim() || !canSubmit}
                className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                <Send className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <p className="my-1.5 text-center text-[10px] text-muted-foreground">
            ArchFlow 可能会犯错，请在生产使用前审查关键决策。
          </p>
        </div>
      </div>
    </section>
  );
};
