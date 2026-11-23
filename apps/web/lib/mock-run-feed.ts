import {
  SSE_DONE,
  type MockRunSnapshot,
  type MockSseFrame,
} from "@arch-flow/shared";

const MAX_FRAMES = 256;
const MAX_CACHED_RUNS = 64;
const RETAIN_TERMINAL_MS = 10 * 60_000;
const HEARTBEAT_MS = 15_000;

export type MockRunEvent = { id: number; frame: MockSseFrame };

type Channel = {
  frames: MockRunEvent[];
  listeners: Set<(event: MockRunEvent) => void>;
  expiresAt: number | null;
};

const terminal = (status: MockRunSnapshot["run"]["status"]) =>
  status === "succeeded" || status === "failed" || status === "canceled";

export const createMockRunFeed = () => {
  const channels = new Map<string, Channel>();
  const encoder = new TextEncoder();

  const getChannel = (key: string) => {
    for (const [channelKey, channel] of channels) {
      if (channel.expiresAt !== null && channel.expiresAt <= Date.now()) {
        channels.delete(channelKey);
      }
    }

    const existing = channels.get(key);
    if (existing) return existing;

    if (channels.size >= MAX_CACHED_RUNS) {
      const oldestTerminal = [...channels].find(
        ([, channel]) => channel.expiresAt !== null,
      );
      if (oldestTerminal) channels.delete(oldestTerminal[0]);
    }
    const channel: Channel = {
      frames: [],
      listeners: new Set(),
      expiresAt: null,
    };
    channels.set(key, channel);
    return channel;
  };

  const publish = (
    key: string,
    events: MockRunEvent[],
    status: MockRunSnapshot["run"]["status"],
  ) => {
    const channel = getChannel(key);
    channel.expiresAt =
      terminal(status) || status === "waiting_input"
        ? Date.now() + RETAIN_TERMINAL_MS
        : null;
    for (const event of events) {
      channel.frames.push(event);
      if (channel.frames.length > MAX_FRAMES) channel.frames.shift();
      for (const listener of channel.listeners) listener(event);
    }
  };

  const open = (
    key: string,
    snapshot: MockRunSnapshot,
    highWatermark: number,
    cursor?: number,
    signal?: AbortSignal,
  ) => {
    const channel = getChannel(key);
    const previous = cursor ?? 0;
    const firstCached = channel.frames[0]?.id;
    const cached = channel.frames.filter(({ id }) => id > previous);
    const currentStatus = snapshot.run.status;
    const waiting = currentStatus === "waiting_input";
    const historicalInterrupt = cached.some(
      ({ frame }) =>
        frame.type === "interrupt" &&
        (!waiting ||
          frame.interruptId !== snapshot.assistantMessage.metadata?.card?.id),
    );
    const unreplayable =
      firstCached === undefined ||
      previous < firstCached - 1 ||
      historicalInterrupt;
    const alreadySettled =
      cached.length === 0 && (waiting || terminal(currentStatus));
    if ((waiting || terminal(currentStatus)) && channel.expiresAt === null) {
      channel.expiresAt = Date.now() + RETAIN_TERMINAL_MS;
    }

    let cleanup: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          let closed = false;
          const release = () => {
            closed = true;
            channel.listeners.delete(send);
            signal?.removeEventListener("abort", close);
            clearInterval(keepalive);
          };
          const close = () => {
            if (closed) return;
            release();
            controller.close();
          };
          const write = (text: string) => {
            if (closed) return;
            if ((controller.desiredSize ?? 0) <= 0) {
              close();
              return;
            }
            controller.enqueue(encoder.encode(text));
          };
          const send = ({ id, frame }: MockRunEvent) => {
            write(`data: ${JSON.stringify(frame)}\nid: ${id}\n\n`);
            if (frame.type === "done") {
              write(`data: ${SSE_DONE}\n\n`);
              close();
            } else if (frame.type === "interrupt") {
              close();
            }
          };
          const keepalive = setInterval(
            () => write(": ping\n\n"),
            HEARTBEAT_MS,
          );
          keepalive.unref();
          cleanup = release;
          if (signal?.aborted) {
            close();
            return;
          }
          if (unreplayable || alreadySettled) {
            send({
              id: highWatermark,
              frame: { type: "snapshot", ...snapshot },
            });
            if (waiting || terminal(currentStatus)) close();
          } else {
            for (const event of cached) send(event);
          }
          if (closed) return;
          channel.listeners.add(send);
          signal?.addEventListener("abort", close, { once: true });
        },
        cancel: () => cleanup?.(),
      },
      { highWaterMark: MAX_FRAMES + 8 },
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  };

  return { publish, open };
};
