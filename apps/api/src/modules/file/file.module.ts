import { Module } from "@nestjs/common";
import { ProjectModule } from "../project/project.module.js";
import { RagModule } from "../rag/rag.module.js";
import { FileController } from "./file.controller.js";
import { FileService } from "./file.service.js";

@Module({
  imports: [ProjectModule, RagModule],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
