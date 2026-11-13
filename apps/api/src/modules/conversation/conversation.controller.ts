import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  CreateConversationInput,
  ForkInput,
  MessageListQuery,
  RewindInput,
  SaveCanvasLayoutInput,
  SaveDraftInput,
  UpdateConversationInput,
  type CanvasLayoutResult,
  type Conversation,
  type ForkResult,
  type Message,
  type Page,
  type SaveDraftResult,
} from "@arch-flow/shared";
import { RawResponse } from "../../common/decorators.js";
import type { AuthUser } from "../../common/request-context.js";
import { CurrentUser } from "../../common/request-context.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ConversationService } from "./conversation.service.js";

@Controller()
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Post("projects/:projectId/conversations")
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(CreateConversationInput))
    input: CreateConversationInput,
  ): Promise<Conversation> {
    return this.conversations.create(user, projectId, input);
  }

  @Get("conversations/:conversationId")
  async get(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
  ): Promise<Conversation> {
    return this.conversations.get(user, conversationId);
  }

  @Patch("conversations/:conversationId")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(UpdateConversationInput))
    input: UpdateConversationInput,
  ): Promise<Conversation> {
    return this.conversations.update(user, conversationId, input);
  }

  @Delete("conversations/:conversationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RawResponse()
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
  ): Promise<void> {
    await this.conversations.remove(user, conversationId);
  }

  @Put("conversations/:conversationId/draft")
  async saveDraft(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(SaveDraftInput, { graph: true }))
    input: SaveDraftInput,
  ): Promise<SaveDraftResult> {
    return this.conversations.saveDraft(user, conversationId, input);
  }

  @Get("conversations/:conversationId/layout")
  async getLayout(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
  ): Promise<CanvasLayoutResult> {
    return this.conversations.getLayout(user, conversationId);
  }

  @Put("conversations/:conversationId/layout")
  async saveLayout(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(SaveCanvasLayoutInput))
    input: SaveCanvasLayoutInput,
  ): Promise<CanvasLayoutResult> {
    return this.conversations.saveLayout(user, conversationId, input);
  }

  @Get("conversations/:conversationId/messages")
  async listMessages(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Query(new ZodValidationPipe(MessageListQuery)) query: MessageListQuery,
  ): Promise<Page<Message>> {
    return this.conversations.listMessages(user, conversationId, query);
  }

  @Post("conversations/:conversationId/fork")
  @HttpCode(HttpStatus.CREATED)
  async fork(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(ForkInput)) input: ForkInput,
  ): Promise<ForkResult> {
    return this.conversations.fork(user, conversationId, input);
  }

  @Post("conversations/:conversationId/rewind")
  @HttpCode(HttpStatus.OK)
  async rewind(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(RewindInput)) input: RewindInput,
  ): Promise<Conversation> {
    return this.conversations.rewind(user, conversationId, input);
  }
}
