import {
  ConversationEntity,
  MessageEntity,
  ProjectEntity,
  RunEntity,
  UserEntity,
} from "@arch-flow/db";
import {
  ERROR_CODES,
  ExperimentalRunMetadata as RunMetadata,
  Message,
  Run,
} from "@arch-flow/shared";
import { HttpException } from "@nestjs/common";
import { type EntityManager, In } from "typeorm";
import { z } from "zod";

export const RUN_ACTIVE_STATUSES = ["queued", "running", "waiting_input"];

export { ExperimentalRunMetadata as RunMetadata } from "@arch-flow/shared";

export const runException = (status: number, code: string, message: string) =>
  new HttpException({ code, message }, status);

export const resourceId = (value: string): string => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success)
    throw runException(400, ERROR_CODES.VALIDATION_FAILED, "资源 ID 格式错误");
  return parsed.data.toLowerCase();
};

export const getOwnedConversation = async (
  manager: EntityManager,
  ownerId: string,
  scope: { conversationId: string } | { runId: string },
) => {
  const query = manager
    .getRepository(ConversationEntity)
    .createQueryBuilder("conversation")
    .innerJoin(ProjectEntity, "project", "project.id = conversation.project_id")
    .innerJoin(UserEntity, "owner", "owner.id = project.user_id")
    .where("owner.uuid = :ownerId", { ownerId })
    .setLock("pessimistic_write", undefined, ["conversation"]);

  if ("runId" in scope) {
    query.innerJoin(
      RunEntity,
      "run",
      "run.conversation_id = conversation.id AND run.uuid = :runId",
      scope,
    );
  } else {
    query.andWhere("conversation.uuid = :conversationId", scope);
  }

  const conversation = await query.getOne();
  if (!conversation) {
    throw "runId" in scope
      ? runException(404, ERROR_CODES.RUN_NOT_FOUND, "运行不存在")
      : runException(404, ERROR_CODES.CONVERSATION_NOT_FOUND, "会话不存在");
  }
  return conversation;
};

export const getRunMessages = async (
  manager: EntityManager,
  run: RunEntity,
) => {
  const messages = await manager.getRepository(MessageEntity).findBy({
    id: In([run.userMessageId, run.assistantMessageId]),
    conversationId: run.conversationId,
  });
  const user = messages.find(({ id }) => id === run.userMessageId);
  const assistant = messages.find(({ id }) => id === run.assistantMessageId);
  if (!user || !assistant)
    throw runException(
      409,
      ERROR_CODES.RUN_NOT_RESUMABLE,
      "运行记录缺少关联消息",
    );
  return { user, assistant };
};

export const snapshotRun = async (
  manager: EntityManager,
  run: RunEntity,
  conversation: ConversationEntity,
) => {
  const { user, assistant } = await getRunMessages(manager, run);
  const metadata = RunMetadata.parse(run.metadata ?? {});
  return {
    run: Run.parse({
      id: run.uuid,
      conversationId: conversation.uuid,
      userMessageId: user.uuid,
      assistantMessageId: assistant.uuid,
      status: run.status,
      finishReason: run.finishReason,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      error:
        run.errorCode && run.errorMessage
          ? { code: run.errorCode, message: run.errorMessage }
          : null,
    }),
    message: Message.parse({
      id: assistant.uuid,
      role: assistant.role,
      content: assistant.content,
      graphSnapshot: assistant.graphSnapshot,
      metadata: assistant.metadata,
      createdAt: assistant.createdAt.toISOString(),
    }),
    interrupt:
      run.status === "waiting_input" ? (metadata.interrupt ?? null) : null,
    draftVersion: conversation.draftVersion,
  };
};
