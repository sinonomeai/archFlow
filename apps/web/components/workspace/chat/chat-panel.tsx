"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Square } from "lucide-react";
import { toast } from "sonner";
import type { Message, Page, ProjectNode } from "@arch-flow/shared";
import { BrandMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { projectQueryKey } from "@/lib/query-keys";
import { useConversation } from "@/hooks/use-conversation";
import { useMessages } from "@/hooks/use-messages";
import {
  DEFAULT_PROJECT_NAME,
  useCreateProject,
} from "@/hooks/use-projects";
import { useRewindConversation } from "@/hooks/use-rewind-conversation";
import { useRunStream } from "@/hooks/use-run-stream";
import { ChatHeader } from "./chat-header";
import { ConstraintCardView } from "./constraint-card";
import { MessageActions } from "./message-actions";

const DRAFT_MIN_HEIGHT = 48;
const DRAFT_MAX_HEIGHT = 96;

const MessageTime = ({ createdAt }: { createdAt: string }) => (
  <p className="text-[10px] text-muted-foreground/70">
    {createdAt.slice(11, 16)}
  </p>
);

const ThinkingDots = () => (
  <span className="flex items-center gap-[3px]" aria-hidden="true">
    <span className="archflow-wave-dot" />
    <span className="archflow-wave-dot" />
    <span className="archflow-wave-dot" />
  </span>
);

export const ChatPanel = ({ conversationId }: { conversationId: string | null }) => {
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const conversation = useConversation(conversationId);
  const messagesQuery = useMessages(conversationId);
  const createProject = useCreateProject();
  const run = useRunStream(conversationId);
  const rewind = useRewindConversation();
  const [rewindTarget, setRewindTarget] = useState<Message | null>(null);
  const messages = messagesQuery.data?.items ?? [];
  const pendingCard = messages.find(
    (message) => message.metadata?.card?.status === "pending",
  )?.metadata?.card;
  /** 多步卡片必须走卡片提交；单卡片允许用底部输入直接回答/忽略。 */
  const hasPendingMultiStepCard = Boolean(
    pendingCard?.steps && pendingCard.steps.length > 1,
  );
  const isLoading = conversation.isPending || messagesQuery.isPending;
  const isError = conversation.isError || messagesQuery.isError;
  const error = conversation.error ?? messagesQuery.error;

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

  useEffect(() => {
    const container = scrollRef.current;

    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, run.isStreaming, run.stage]);

  const handleSend = async () => {
    const content = draft.trim();

    if (!content || run.isStreaming) {
      return;
    }

    if (hasPendingMultiStepCard) {
      toast.info("请先完成上方的约束卡片");
      return;
    }

    if (!conversationId) {
      const cachedProjects =
        queryClient.getQueryData<Page<ProjectNode>>(projectQueryKey);

      if (cachedProjects && cachedProjects.items.length > 0) {
        toast.info("请先从左侧选择一个会话");
        return;
      }

      setDraft("");
      createProject.mutate(
        { name: DEFAULT_PROJECT_NAME },
        {
          onSuccess: (project) => {
            const next = project.lastActiveConversationId;

            if (next) {
              router.replace(`/workspace?conversationId=${next}`);
            }
          },
          onError: (cause) => {
            setDraft(content);
            toast.error(cause.message);
          },
        },
      );
      return;
    }

    setDraft("");

    try {
      await run.sendMessage(content);
    } catch (cause) {
      setDraft(content);
      toast.error(cause instanceof Error ? cause.message : "发送失败");
    }
  };

  const sendTooltip = run.isStreaming
    ? "正在生成，请先停止"
    : hasPendingMultiStepCard
      ? "请先完成上方的约束卡片"
      : !draft.trim()
        ? "请输入内容"
        : conversationId
          ? "发送消息"
          : "发送并创建项目";

  const handleRewind = () => {
    if (!rewindTarget || !conversationId) {
      return;
    }

    rewind.mutate(
      {
        conversationId,
        sourceMessageId: rewindTarget.id,
      },
      {
        onSuccess: () => setRewindTarget(null),
      },
    );
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-background">
      <ChatHeader conversation={conversation.data ?? null} />

      <div
        ref={scrollRef}
        className="arch-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-6"
      >
        {!conversationId && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <BrandMark className="size-8 opacity-60" />
            <p className="mt-4 text-sm font-medium">还没有选择会话</p>
            <p className="mt-1 max-w-[240px] text-[11px] leading-5 text-muted-foreground">
              从左侧项目树选择一个会话，或新建项目开始。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={createProject.isPending}
              onClick={() => createProject.mutate({ name: DEFAULT_PROJECT_NAME })}
            >
              {createProject.isPending ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              ) : null}
              创建你的第一个项目
            </Button>
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

        {conversation.data && !isLoading && !isError && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <BrandMark className="size-8 opacity-60" />
            <p className="mt-4 text-sm font-medium">从一个约束开始</p>
            <p className="mt-1 max-w-[280px] text-[11px] leading-5 text-muted-foreground">
              例如：团队 3 人、预算有限、需要支持实时协作。描述你的场景，Agent
              会追问约束并生成架构。
            </p>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              className="group/message mt-6 flex flex-col items-end"
            >
              <div className="max-w-[88%] rounded-xl rounded-tr-sm bg-secondary px-4 py-3 text-[13px] leading-6 text-secondary-foreground">
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <MessageActions
                  message={message}
                  onRewind={() => setRewindTarget(message)}
                  onFork={() => {
                    void run.forkMessage(message.id);
                  }}
                />
                <MessageTime createdAt={message.createdAt} />
              </div>
            </div>
          ) : (
            <div key={message.id} className="group/message mt-6 flex items-start gap-3">
              <BrandMark className="mt-0.5 size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                {/* 已作答的卡片移到正文上方，避免最终回答出现在旧卡片之上。 */}
                {message.metadata?.card &&
                  message.metadata.card.status !== "pending" && (
                    <ConstraintCardView
                      card={message.metadata.card}
                      disabled
                      onSubmit={() => undefined}
                    />
                  )}

                {message.content && (
                  <p className="whitespace-pre-wrap text-[13px] leading-6">
                    {message.content}
                  </p>
                )}

                {run.isStreaming &&
                  message.id === run.assistantMessageId && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      正在思考
                      <ThinkingDots />
                    </p>
                  )}

                {message.metadata?.card?.status === "pending" && (
                  <ConstraintCardView
                    card={message.metadata.card}
                    disabled={run.isStreaming}
                    onSubmit={(payload) => {
                      void run
                        .answerCard(message.id, {
                          cardId: message.metadata?.card?.id,
                          isCustom: false,
                          ...payload,
                        })
                        .catch((cause: unknown) => {
                          toast.error(
                            cause instanceof Error ? cause.message : "提交失败",
                          );
                        });
                    }}
                  />
                )}

                {message.metadata?.citations &&
                  message.metadata.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.metadata.citations.map((citation) => (
                        <span
                          key={`${citation.fileId}-${citation.snippet.slice(0, 12)}`}
                          title={citation.snippet}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {citation.fileName}
                        </span>
                      ))}
                    </div>
                  )}

                <div className="mt-1 flex items-center gap-1.5">
                  <MessageActions
                    message={message}
                    onRewind={() => setRewindTarget(message)}
                    onFork={() => {
                      void run.forkMessage(message.id);
                    }}
                  />
                  <MessageTime createdAt={message.createdAt} />
                </div>
              </div>
            </div>
          ),
        )}
      </div>

      <div className="relative shrink-0">
        <div className="z-10 border-border bg-background p-4 pb-0">
          <div className="rounded-xl border border-border bg-card p-3">
            <textarea
              ref={draftRef}
              rows={2}
              value={draft}
              disabled={run.isStreaming || hasPendingMultiStepCard}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                hasPendingMultiStepCard
                  ? "请先完成上方的约束卡片"
                  : "描述你的技术约束或回答问题..."
              }
              className="arch-scrollbar w-full resize-none overflow-y-auto bg-transparent text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {run.isStreaming && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="停止生成"
                      onClick={() => {
                        void run.cancel();
                      }}
                      className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Square className="size-3" strokeWidth={2} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">停止生成</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-label={sendTooltip}
                    className="inline-flex rounded-md"
                  >
                    <button
                      type="button"
                      aria-label={sendTooltip}
                      onClick={() => {
                        void handleSend();
                      }}
                      disabled={
                        !draft.trim() ||
                        run.isStreaming ||
                        hasPendingMultiStepCard
                      }
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40",
                      )}
                    >
                      <Send className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">{sendTooltip}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <p className="my-1.5 text-center text-[10px] text-muted-foreground">
            ArchFlow 可能会犯错，请在生产使用前审查关键决策。
          </p>
        </div>
      </div>

      <Dialog
        open={rewindTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRewindTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>回退到该消息？</DialogTitle>
            <DialogDescription>
              该消息之后的全部消息会被删除，画布恢复到该时间点。此操作不可撤销；如果想保留当前会话，请选择“以此开启新对话”。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRewindTarget(null)}
              disabled={rewind.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleRewind}
              disabled={rewind.isPending}
            >
              确认回退
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
