import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  ERROR_CODES,
  MAX_FILE_SIZE_BYTES,
  resolveFileType,
  type FileIdsQuery,
  type FileListQuery,
  type FileMeta,
  type FileStatusResult,
  type Page,
} from "@arch-flow/shared";
import { KnowledgeFileEntity } from "@arch-flow/db";
import { apiError } from "../../common/api-error.js";
import {
  decodeCursor,
  encodeCursor,
} from "../../common/pagination.js";
import type { AuthUser } from "../../common/request-context.js";
import { DatabaseService } from "../../database/database.service.js";
import { StorageService } from "../../infra/storage.service.js";
import { ProjectService } from "../project/project.service.js";
import { RagService } from "../rag/rag.service.js";

const MIME_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export type FileContent = {
  key: string;
  mimeType: string;
  size: number;
  fileName: string;
};

/** 只依赖 Multer 实际提供的字段，避免全局 Express.Multer 类型扩展。 */
export type UploadedFilePayload = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const toFileMeta = (file: KnowledgeFileEntity): FileMeta => ({
  id: file.uuid,
  fileName: file.fileName,
  fileType: file.fileType as FileMeta["fileType"],
  mimeType: file.mimeType,
  sizeBytes: file.fileSize,
  status: file.status as FileMeta["status"],
  errorMessage: file.errorMessage,
  createdAt: file.createdAt.toISOString(),
});

const mimeFor = (fileName: string, fallback: string): string => {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  return MIME_TYPES[extension] ?? fallback;
};

const sanitizeName = (fileName: string): string =>
  fileName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);

/**
 * Multer 按 latin1 解析 multipart 文件名，中文会变成乱码。
 * 能无损转成 UTF-8 才采用，否则保留原值，避免二次破坏。
 */
const decodeFileName = (fileName: string): string => {
  const decoded = Buffer.from(fileName, "latin1").toString("utf8");

  return decoded.includes("�") ? fileName : decoded;
};

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly projects: ProjectService,
    private readonly storage: StorageService,
    private readonly rag: RagService,
  ) {}

  private readonly repository = () =>
    this.database.dataSource.getRepository(KnowledgeFileEntity);

  upload = async (
    user: AuthUser,
    projectUuid: string,
    file: UploadedFilePayload,
  ): Promise<FileMeta> => {
    const project = await this.projects.requireEntity(user, projectUuid);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw apiError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        ERROR_CODES.FILE_TOO_LARGE,
        "单个文件不能超过 20MB",
      );
    }

    const fileName = decodeFileName(file.originalname);
    const fileType = resolveFileType(fileName);

    if (!fileType) {
      throw apiError(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        ERROR_CODES.FILE_TYPE_UNSUPPORTED,
        "不支持的文件类型",
      );
    }

    const key = `projects/${project.uuid}/${randomUUID()}-${sanitizeName(fileName)}`;
    const mimeType = mimeFor(fileName, file.mimetype);
    const status = fileType === "text" || fileType === "image" ? "processing" : "stored";

    await this.storage.client.putObject(
      this.storage.bucket,
      key,
      file.buffer,
      file.size,
      { "Content-Type": mimeType },
    );

    const record = this.repository().create({
      projectId: project.id,
      fileName,
      fileType,
      mimeType,
      fileSize: file.size,
      fileUrl: key,
      status,
      errorMessage: null,
    });

    await this.repository().save(record);

    if (fileType === "text") {
      void this.processText(record, file.buffer);
    } else if (fileType === "image") {
      /** MVP 可视模型接入前，图片只存储；解析能力见 P1-04。 */
      record.status = "stored";
      record.errorMessage = "图片解析尚未接入视觉模型";
      await this.repository().save(record);
    }

    return toFileMeta(record);
  };

  list = async (
    user: AuthUser,
    projectUuid: string,
    query: FileListQuery,
  ): Promise<Page<FileMeta>> => {
    const project = await this.projects.requireEntity(user, projectUuid);
    const builder = this.repository()
      .createQueryBuilder("file")
      .where("file.projectId = :projectId", { projectId: project.id })
      .orderBy("file.createdAt", "DESC")
      .addOrderBy("file.id", "DESC")
      .take(query.limit + 1);

    if (query.status) {
      builder.andWhere("file.status = :status", { status: query.status });
    }

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);

      if (!decoded) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.VALIDATION_FAILED,
          "分页游标不合法",
        );
      }

      builder.andWhere(
        "(file.createdAt, file.id) < (:createdAt, :id)",
        { createdAt: decoded.updatedAt, id: decoded.id },
      );
    }

    const rows = await builder.getMany();
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);

    return {
      items: items.map(toFileMeta),
      nextCursor:
        hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      hasMore,
    };
  };

  get = async (user: AuthUser, fileUuid: string): Promise<FileMeta> =>
    toFileMeta(await this.requireEntity(user, fileUuid));

  status = async (
    user: AuthUser,
    projectUuid: string,
    query: FileIdsQuery,
  ): Promise<FileStatusResult> => {
    const project = await this.projects.requireEntity(user, projectUuid);
    const files = await this.repository()
      .createQueryBuilder("file")
      .where("file.projectId = :projectId", { projectId: project.id })
      .andWhere("file.uuid IN (:...ids)", { ids: query.ids })
      .getMany();

    return {
      items: files.map((file) => ({
        id: file.uuid,
        status: file.status as FileMeta["status"],
        errorMessage: file.errorMessage,
      })),
    };
  };

  content = async (user: AuthUser, fileUuid: string): Promise<FileContent> => {
    const file = await this.requireEntity(user, fileUuid);
    const stat = await this.storage.client.statObject(
      this.storage.bucket,
      file.fileUrl,
    );

    return {
      key: file.fileUrl,
      mimeType: file.mimeType,
      size: stat.size,
      fileName: file.fileName,
    };
  };

  openContent = async (
    key: string,
    offset?: number,
    length?: number,
  ): Promise<Readable> => {
    if (offset === undefined) {
      return this.storage.client.getObject(this.storage.bucket, key);
    }

    return this.storage.client.getPartialObject(
      this.storage.bucket,
      key,
      offset,
      length,
    );
  };

  remove = async (
    user: AuthUser,
    projectUuid: string,
    fileUuid: string,
  ): Promise<void> => {
    const project = await this.projects.requireEntity(user, projectUuid);
    const file = await this.repository().findOneBy({
      uuid: fileUuid,
      projectId: project.id,
    });

    if (!file) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.FILE_NOT_FOUND,
        "文件不存在",
      );
    }

    await this.repository().remove(file);

    try {
      await this.storage.client.removeObject(this.storage.bucket, file.fileUrl);
    } catch (error) {
      this.logger.warn(
        `删除对象存储文件失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  private readonly processText = async (
    file: KnowledgeFileEntity,
    buffer: Buffer,
  ): Promise<void> => {
    try {
      await this.rag.indexFile(file, buffer.toString("utf8"));
      file.status = "ready";
      file.errorMessage = null;
      await this.repository().save(file);
    } catch (error) {
      file.status = "failed";
      file.errorMessage =
        error instanceof Error ? error.message.slice(0, 500) : "解析失败";
      await this.repository().save(file);
      this.logger.warn(`文件解析失败 ${file.fileName}：${file.errorMessage}`);
    }
  };

  private readonly requireEntity = async (
    user: AuthUser,
    fileUuid: string,
  ): Promise<KnowledgeFileEntity> => {
    const file = await this.repository().findOneBy({ uuid: fileUuid });

    if (!file) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.FILE_NOT_FOUND,
        "文件不存在",
      );
    }

    await this.projects.requireById(user, file.projectId);

    return file;
  };
}
