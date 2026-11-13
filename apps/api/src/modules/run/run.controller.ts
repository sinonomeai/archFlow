import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  AnswerCardInput,
  SendMessageInput,
  type CancelResult,
  type Run,
  type RunAccepted,
} from "@arch-flow/shared";
import { RawResponse } from "../../common/decorators.js";
import type { AuthUser } from "../../common/request-context.js";
import { CurrentUser, TraceId } from "../../common/request-context.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { RunService } from "./run.service.js";

@Controller()
export class RunController {
  constructor(private readonly runs: RunService) {}

  @Post("conversations/:conversationId/messages")
  @HttpCode(HttpStatus.ACCEPTED)
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(SendMessageInput)) input: SendMessageInput,
    @TraceId() traceId: string,
  ): Promise<RunAccepted> {
    return this.runs.sendMessage(user, conversationId, input, traceId);
  }

  @Post("conversations/:conversationId/messages/:messageId/answer")
  @HttpCode(HttpStatus.ACCEPTED)
  async answerCard(
    @CurrentUser() user: AuthUser,
    @Param("conversationId") conversationId: string,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(AnswerCardInput)) input: AnswerCardInput,
    @TraceId() traceId: string,
  ): Promise<RunAccepted> {
    return this.runs.answerCard(user, conversationId, messageId, input, traceId);
  }

  @Get("runs/:runId")
  async get(
    @CurrentUser() user: AuthUser,
    @Param("runId") runId: string,
  ): Promise<Run> {
    return this.runs.getRun(user, runId);
  }

  @Post("runs/:runId/cancel")
  @HttpCode(HttpStatus.ACCEPTED)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param("runId") runId: string,
  ): Promise<CancelResult> {
    return this.runs.cancel(user, runId);
  }

  @Get("runs/:runId/stream")
  @RawResponse()
  async stream(
    @CurrentUser() user: AuthUser,
    @Param("runId") runId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const raw = request.headers["last-event-id"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? Number(value) : Number.NaN;

    await this.runs.stream(
      user,
      runId,
      Number.isFinite(parsed) ? parsed : undefined,
      request,
      response,
    );
  }
}
