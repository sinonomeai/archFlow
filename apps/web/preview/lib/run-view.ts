import type {
  Message,
  MockRunAccepted,
  MockSseFrame,
  RunStage,
  RunStatus,
} from "@arch-flow/shared";

export type RunView = {
  runId: string;
  status: RunStatus;
  stage: RunStage | null;
  message: Message;
  error: string | null;
};

export const isRunInProgress = (status: RunStatus | undefined) =>
  status === "queued" || status === "running";

export const createRunView = (
  run: MockRunAccepted,
  createdAt = new Date().toISOString(),
): RunView => ({
  runId: run.runId,
  status: run.status,
  stage: null,
  message: {
    id: run.assistantMessageId,
    content: "",
    role: "assistant",
    createdAt,
    graphSnapshot: null,
    metadata: null,
  },
  error: null,
});

export const applyRunFrame = (view: RunView, frame: MockSseFrame): RunView => {
  const { message } = view;
  switch (frame.type) {
    case "snapshot":
      if (
        frame.run.id !== view.runId ||
        frame.assistantMessage.id !== message.id
      ) {
        throw new Error("任务快照与当前会话不匹配");
      }
      return {
        ...view,
        message: frame.assistantMessage,
        status: frame.run.status,
        stage: frame.stage,
        error: frame.run.error?.message ?? null,
      };
    case "run-start":
      if (
        frame.runId !== view.runId ||
        frame.assistantMessageId !== message.id
      ) {
        throw new Error("生成事件与当前会话不匹配");
      }
      return { ...view, status: "running", stage: null, error: null };
    case "status":
      return { ...view, status: "running", stage: frame.stage };
    case "text-delta":
      if (frame.messageId !== message.id) return view;
      return {
        ...view,
        message: {
          ...message,
          content: frame.replace
            ? frame.content
            : message.content + frame.content,
        },
      };
    case "citation":
      return {
        ...view,
        message: {
          ...message,
          metadata: { ...message.metadata, citations: frame.sources },
        },
      };
    case "graph":
      return { ...view, message: { ...message, graphSnapshot: frame.graph } };
    case "constraint-card":
      if (frame.messageId !== message.id) return view;
      return {
        ...view,
        message: {
          ...message,
          metadata: { ...message.metadata, card: frame.card },
        },
      };
    case "card-updated": {
      const card = message.metadata?.card;
      if (!card || card.id !== frame.cardId) return view;
      return {
        ...view,
        message: {
          ...message,
          metadata: {
            ...message.metadata,
            card: { ...card, status: frame.status, answer: frame.answer },
          },
        },
      };
    }
    case "interrupt":
      return { ...view, status: "waiting_input", stage: null };
    case "error":
      return { ...view, error: frame.message };
    case "done": {
      if (frame.assistantMessageId !== message.id) return view;
      const status =
        frame.finishReason === "error"
          ? "failed"
          : frame.finishReason === "canceled"
            ? "canceled"
            : "succeeded";
      return { ...view, status, stage: null };
    }
    default:
      return view;
  }
};
