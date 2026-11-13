import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { DatabaseModule } from "./database/database.module.js";
import { InfraModule } from "./infra/infra.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { ZodValidationPipe } from "./common/zod-validation.pipe.js";
import { ApiResponseInterceptor } from "./common/api-response.interceptor.js";
import {
  IdempotencyInterceptor,
  IdempotencyService,
} from "./common/idempotency.js";
import { AssetModule } from "./modules/asset/asset.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { ConversationModule } from "./modules/conversation/conversation.module.js";
import { FileModule } from "./modules/file/file.module.js";
import { ProjectModule } from "./modules/project/project.module.js";
import { RagModule } from "./modules/rag/rag.module.js";
import { RunModule } from "./modules/run/run.module.js";
import { SystemModule } from "./modules/system/system.module.js";

/**
 * 根模块：基础设施 + 全局管道 / 过滤器 / 拦截器 + 已接入业务模块。
 * 业务模块按 P0 顺序接入，模块间只通过 Service 交互，禁止跨模块直查表。
 */
@Module({
  imports: [
    DatabaseModule,
    InfraModule,
    AuthModule,
    ProjectModule,
    ConversationModule,
    AssetModule,
    RagModule,
    FileModule,
    RunModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    IdempotencyService,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
  ],
})
export class AppModule {}
