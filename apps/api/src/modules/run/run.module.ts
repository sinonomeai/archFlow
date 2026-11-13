import { Module } from "@nestjs/common";
import { ConversationModule } from "../conversation/conversation.module.js";
import { RagModule } from "../rag/rag.module.js";
import { RunController } from "./run.controller.js";
import { RunService } from "./run.service.js";
import { SseHubService } from "./sse-hub.service.js";

@Module({
  imports: [ConversationModule, RagModule],
  controllers: [RunController],
  providers: [RunService, SseHubService],
  exports: [RunService],
})
export class RunModule {}
