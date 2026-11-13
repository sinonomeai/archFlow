import { Injectable } from "@nestjs/common";

export type StoredFrame = {
  id: number;
  data: string;
};

type Subscriber = (frame: StoredFrame) => void;

type Channel = {
  frames: StoredFrame[];
  nextId: number;
  subscribers: Set<Subscriber>;
  expiresAt: number | null;
};

const BUFFER_TTL_MS = 10 * 60 * 1000;

/**
 * 单实例 SSE 事件缓冲（P0-06）。
 * 只用于逐帧重放；数据库仍是权威数据源。进程重启后缓冲丢失，由 RunService 合成快照。
 */
@Injectable()
export class SseHubService {
  private readonly channels = new Map<string, Channel>();

  ensure = (runId: string): Channel => {
    const existing = this.channels.get(runId);

    if (existing) {
      return existing;
    }

    const channel: Channel = {
      frames: [],
      nextId: 1,
      subscribers: new Set(),
      expiresAt: null,
    };
    this.channels.set(runId, channel);

    return channel;
  };

  publish = (runId: string, frame: unknown): StoredFrame => {
    const channel = this.ensure(runId);
    const stored: StoredFrame = {
      id: channel.nextId,
      data: JSON.stringify(frame),
    };
    channel.nextId += 1;
    channel.frames.push(stored);

    for (const subscriber of channel.subscribers) {
      subscriber(stored);
    }

    return stored;
  };

  /**
   * HITL resume：清掉上一段中断的帧，避免重连时先重放旧的 interrupt。
   * nextId 必须保持单调递增：客户端会带着上一段的 Last-Event-ID 重连，
   * 如果从 1 重新计数，服务端会误判「Last-Event-ID 超出范围」并返回 409。
   */
  reset = (runId: string): void => {
    const channel = this.ensure(runId);
    channel.frames = [];
    channel.expiresAt = null;
  };

  markTerminal = (runId: string): void => {
    const channel = this.channels.get(runId);

    if (!channel) {
      return;
    }

    channel.expiresAt = Date.now() + BUFFER_TTL_MS;
    setTimeout(() => {
      this.channels.delete(runId);
    }, BUFFER_TTL_MS).unref();
  };

  subscribe = (runId: string, subscriber: Subscriber): (() => void) => {
    const channel = this.ensure(runId);
    channel.subscribers.add(subscriber);

    return () => {
      channel.subscribers.delete(subscriber);
    };
  };

  replay = (runId: string, lastEventId?: number): StoredFrame[] => {
    const channel = this.channels.get(runId);

    if (!channel) {
      return [];
    }

    return lastEventId === undefined
      ? [...channel.frames]
      : channel.frames.filter((frame) => frame.id > lastEventId);
  };

  lastId = (runId: string): number => {
    const channel = this.channels.get(runId);

    return channel?.nextId ?? 1;
  };

  hasBuffer = (runId: string): boolean => this.channels.has(runId);
}
