import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export type AuthUser = {
  /** 内部自增 id，仅服务端使用。 */
  internalId: string;
  uuid: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  createdAt: Date;
};

export type RequestWithContext = Request & {
  traceId?: string;
  user?: AuthUser;
};

export const getRequest = (context: ExecutionContext): RequestWithContext =>
  context.switchToHttp().getRequest<RequestWithContext>();

export const TraceId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    getRequest(context).traceId ?? "",
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const user = getRequest(context).user;

    if (!user) {
      throw new Error("CurrentUser 只能在受保护路由中使用");
    }

    return user;
  },
);
