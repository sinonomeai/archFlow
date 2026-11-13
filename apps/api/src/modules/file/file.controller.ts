import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import {
  ERROR_CODES,
  FileIdsQuery,
  FileListQuery,
  MAX_FILE_SIZE_BYTES,
  type FileMeta,
  type FileStatusResult,
  type Page,
} from "@arch-flow/shared";
import { apiError } from "../../common/api-error.js";
import { RawResponse } from "../../common/decorators.js";
import type { AuthUser } from "../../common/request-context.js";
import { CurrentUser } from "../../common/request-context.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import type { UploadedFilePayload } from "./file.service.js";
import { FileService } from "./file.service.js";

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

@Controller()
export class FileController {
  constructor(private readonly files: FileService) {}

  @Post("projects/:projectId/files")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @UploadedFile() file: UploadedFilePayload | undefined,
  ): Promise<FileMeta> {
    if (!file) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODES.VALIDATION_FAILED,
        "缺少上传文件（表单字段 file）",
      );
    }

    return this.files.upload(user, projectId, file);
  }

  @Get("projects/:projectId/files")
  async list(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(FileListQuery)) query: FileListQuery,
  ): Promise<Page<FileMeta>> {
    return this.files.list(user, projectId, query);
  }

  @Get("projects/:projectId/files/status")
  async status(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(FileIdsQuery)) query: FileIdsQuery,
  ): Promise<FileStatusResult> {
    return this.files.status(user, projectId, query);
  }

  @Get("files/:fileId")
  async get(
    @CurrentUser() user: AuthUser,
    @Param("fileId") fileId: string,
  ): Promise<FileMeta> {
    return this.files.get(user, fileId);
  }

  @Get("files/:fileId/content")
  @RawResponse()
  async content(
    @CurrentUser() user: AuthUser,
    @Param("fileId") fileId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const content = await this.files.content(user, fileId);
    const range = request.headers.range;

    if (!range) {
      response.status(HttpStatus.OK);
      response.setHeader("Content-Type", content.mimeType);
      response.setHeader("Content-Length", content.size);
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
      );

      const stream = await this.files.openContent(content.key);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
      return;
    }

    const match = RANGE_PATTERN.exec(range);
    const start = Number(match?.[1] ?? 0);
    const requestedEnd = match?.[2] ? Number(match[2]) : content.size - 1;
    const end = Math.min(requestedEnd, content.size - 1);

    if (!match || Number.isNaN(start) || start >= content.size || start > end) {
      response.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      response.setHeader("Content-Range", `bytes */${content.size}`);
      response.end();
      return;
    }

    response.status(HttpStatus.PARTIAL_CONTENT);
    response.setHeader("Content-Type", content.mimeType);
    response.setHeader("Content-Length", end - start + 1);
    response.setHeader("Content-Range", `bytes ${start}-${end}/${content.size}`);
    response.setHeader("Accept-Ranges", "bytes");

    const stream = await this.files.openContent(
      content.key,
      start,
      end - start + 1,
    );
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  }

  @Delete("projects/:projectId/files/:fileId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RawResponse()
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("projectId") projectId: string,
    @Param("fileId") fileId: string,
  ): Promise<void> {
    await this.files.remove(user, projectId, fileId);
  }
}
