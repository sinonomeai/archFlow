import {
  EventStreamContentType,
  fetchEventSource,
} from "@microsoft/fetch-event-source";
import { parseMockSseData, type MockSseFrame } from "@arch-flow/shared";
import { authenticatedFetch } from "./api-client";

const SAFE_STREAM_URL = /^\/api\/(?:mock|v1)\/runs\/[A-Za-z0-9_-]+\/stream$/;
const STREAM_IDLE_TIMEOUT_MS = 45_000;
const RECONNECT_DELAYS_MS = [200, 600, 1_800];

type StreamOutcome = "terminal" | "waiting_input" | "detached";

type StreamOptions = {
  signal: AbortSignal;
  onFrame: (frame: MockSseFrame) => void;
  onConnectionChange?: (connected: boolean) => void;
};

class StreamHttpError extends Error {
  constructor(readonly status: number) {
    super(`无法连接生成任务（HTTP ${status}）`);
  }
}

export const waitForRunRetry = (delay: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });

const getOutcome = (frame: MockSseFrame): StreamOutcome | undefined => {
  if (frame.type === "done") return "terminal";
  if (frame.type === "interrupt") return "waiting_input";
  if (frame.type !== "snapshot") return;
  const { status } = frame.run;
  if (status === "waiting_input") return "waiting_input";
  if (status === "succeeded" || status === "failed" || status === "canceled") {
    return "terminal";
  }
};

export const connectRunStream = async (
  streamUrl: string,
  { signal, onFrame, onConnectionChange }: StreamOptions,
): Promise<StreamOutcome> => {
  if (!SAFE_STREAM_URL.test(streamUrl))
    throw new Error("生成任务的订阅地址无效");

  let lastApplied: number | undefined;
  let outcome: StreamOutcome | undefined;
  for (let attempt = 0; !signal.aborted; attempt += 1) {
    const controller = new AbortController();
    const detach = () => controller.abort();
    signal.addEventListener("abort", detach, { once: true });
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(detach, STREAM_IDLE_TIMEOUT_MS);
    };
    resetIdle();

    try {
      await fetchEventSource(streamUrl, {
        method: "GET",
        openWhenHidden: true,
        signal: controller.signal,
        headers:
          lastApplied === undefined
            ? {}
            : { "last-event-id": String(lastApplied) },
        fetch: (_input, init) => {
          const headers = new Headers(init?.headers);
          if (lastApplied === undefined) headers.delete("last-event-id");
          else headers.set("last-event-id", String(lastApplied));
          return authenticatedFetch(streamUrl, { ...init, headers });
        },
        onopen: async (response) => {
          if (!response.ok) throw new StreamHttpError(response.status);
          if (
            !response.body ||
            !response.headers
              .get("content-type")
              ?.toLowerCase()
              .startsWith(EventStreamContentType)
          ) {
            throw new Error("服务端没有返回事件流");
          }
          onConnectionChange?.(true);
        },
        onmessage: ({ id, data }) => {
          if (controller.signal.aborted) return;
          resetIdle();
          if (!data) return;
          const frame = parseMockSseData(data);
          if (!frame) return;
          const sequence = Number(id);
          if (!/^\d+$/.test(id) || !Number.isSafeInteger(sequence)) {
            throw new Error("生成事件缺少有效序号");
          }
          if (
            frame.type !== "snapshot" &&
            lastApplied !== undefined &&
            sequence <= lastApplied
          ) {
            return;
          }

          onFrame(frame);
          lastApplied = sequence;
          outcome = getOutcome(frame);
          if (outcome) detach();
        },
        onerror: (error: unknown) => {
          throw error;
        },
      });
      if (outcome) return outcome;
      if (signal.aborted) return "detached";
      throw new Error("生成连接已断开");
    } catch (error) {
      if (signal.aborted) return "detached";
      const delay = RECONNECT_DELAYS_MS[attempt];
      if (
        delay === undefined ||
        (error instanceof StreamHttpError && error.status < 500)
      ) {
        throw error;
      }
      onConnectionChange?.(false);
      await waitForRunRetry(delay, signal);
    } finally {
      clearTimeout(idleTimer);
      signal.removeEventListener("abort", detach);
      detach();
    }
  }
  return "detached";
};
