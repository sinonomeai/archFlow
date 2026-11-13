"use client";

import { fetchEventSource } from "@microsoft/fetch-event-source";
import { parseSseData, type SseFrame } from "@arch-flow/shared";
import { apiUrl } from "./api-config";
import { refreshAccessToken } from "./auth";
import { useAuthStore } from "./auth-store";

const lastEventKey = (runId: string): string =>
  `archflow:last-event-id:${runId}`;

type ConnectOptions = {
  runId: string;
  streamUrl: string;
  signal: AbortSignal;
  onFrame: (frame: SseFrame) => void;
  onError: (error: Error) => void;
  onClose?: () => void;
};

/**
 * 使用 fetch-event-source 消费 SSE（不能使用原生 EventSource）。
 * 每帧 id 写入 sessionStorage，重连时作为 Last-Event-ID 续传。
 */
export const connectRunStream = async ({
  runId,
  streamUrl,
  signal,
  onFrame,
  onError,
  onClose,
}: ConnectOptions): Promise<void> => {
  /** 页面刷新后先静默续期，避免带着空 token 建立 SSE。 */
  if (!useAuthStore.getState().accessToken) {
    await refreshAccessToken();
  }

  const token = useAuthStore.getState().accessToken ?? "";
  const lastEventId =
    typeof window === "undefined"
      ? null
      : window.sessionStorage.getItem(lastEventKey(runId));

  await fetchEventSource(apiUrl(streamUrl), {
    method: "GET",
    openWhenHidden: true,
    signal,
    headers: {
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
    },
    onopen: async (response) => {
      if (response.ok) {
        return;
      }

      throw new Error(`SSE 连接失败（HTTP ${response.status}）`);
    },
    onmessage: (event) => {
      if (event.id && typeof window !== "undefined") {
        window.sessionStorage.setItem(lastEventKey(runId), event.id);
      }

      if (!event.data) {
        return;
      }

      const frame = parseSseData(event.data);

      if (frame === null) {
        onClose?.();
        return;
      }

      onFrame(frame);

      if (frame.type === "done" || frame.type === "interrupt") {
        onClose?.();
      }
    },
    onclose: () => {
      onClose?.();
    },
    onerror: (error) => {
      onError(error instanceof Error ? error : new Error(String(error)));
      /** 抛出后 fetch-event-source 不再自动重试，由调用方决定下一步。 */
      throw error;
    },
  });
};
