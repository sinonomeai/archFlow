"use client";

import { Split, Undo2 } from "lucide-react";
import type { Message } from "@arch-flow/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type MessageActionsProps = {
  message: Message;
  onRewind: () => void;
  onFork: () => void;
};

/** 消息气泡右上角的圆形回退入口，hover 时出现。 */
export const MessageActions = ({
  message,
  onRewind,
  onFork,
}: MessageActionsProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={`回退到这条消息：${message.content.slice(0, 20)}`}
        className="flex size-5 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/message:opacity-100"
      >
        <Undo2 className="relative top-[-2px] size-3" strokeWidth={1.75} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={6} className="w-44">
      <DropdownMenuItem className="text-xs" onSelect={onRewind}>
        <Undo2 className="size-3.5" strokeWidth={1.75} />
        回退到该消息
      </DropdownMenuItem>
      <DropdownMenuItem className="text-xs" onSelect={onFork}>
        <Split className="size-3.5" strokeWidth={1.75} />
        以此开启新对话
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
