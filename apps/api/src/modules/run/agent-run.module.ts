import { Module } from "@nestjs/common";
import { createAgentEngine, createOpenAIAdapter } from "@arch-flow/agent";
import { loadEnv } from "../../config/env.js";
import { DatabaseService } from "../../database/database.service.js";
import { AgentRunService, RUN_ENGINE } from "./agent-run.service.js";
import { createKnowledgeSearch } from "./knowledge-search.js";

@Module({
  providers: [
    {
      provide: RUN_ENGINE,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => {
        const env = loadEnv();
        if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) return null;

        const { model, embed } = createOpenAIAdapter({
          chat: {
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_MODEL,
            baseURL: env.OPENAI_BASE_URL,
          },
          embedding: env.OPENAI_EMBEDDING_MODEL
            ? {
                apiKey: env.OPENAI_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY,
                model: env.OPENAI_EMBEDDING_MODEL,
                baseURL: env.OPENAI_EMBEDDING_BASE_URL ?? env.OPENAI_BASE_URL,
              }
            : undefined,
        });
        return createAgentEngine({
          model,
          embed,
          searchKnowledge: createKnowledgeSearch(database.dataSource, embed),
        });
      },
    },
    AgentRunService,
  ],
  exports: [AgentRunService],
})
export class AgentRunModule {}
