import { Module } from "@nestjs/common";
import { EmbeddingService } from "./embedding.service.js";
import { RagService } from "./rag.service.js";

@Module({
  providers: [EmbeddingService, RagService],
  exports: [EmbeddingService, RagService],
})
export class RagModule {}
