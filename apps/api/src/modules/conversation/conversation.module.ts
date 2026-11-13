import { Module } from "@nestjs/common";
import { ProjectModule } from "../project/project.module.js";
import { ConversationController } from "./conversation.controller.js";
import { ConversationService } from "./conversation.service.js";

@Module({
  imports: [ProjectModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
