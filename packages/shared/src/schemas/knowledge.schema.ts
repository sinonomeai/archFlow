import { z } from "zod";
import {
  Count,
  FileStatus,
  FileType,
  Id,
  ISODateTime,
  PaginationQuery,
} from "./common.schema.js";

/** 单文件上限（§7.1）。 */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** 扩展名白名单（§7.1）：不在表内一律 415。 */
export const FILE_EXTENSION_TO_TYPE: Record<string, FileType> = {
  md: "text",
  markdown: "text",
  txt: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  pdf: "pdf",
  docx: "docx",
};

export const SUPPORTED_FILE_ACCEPT = Object.keys(FILE_EXTENSION_TO_TYPE)
  .map((extension) => `.${extension}`)
  .join(",");

/** 按扩展名解析 fileType；不在白名单内返回 null。 */
export const resolveFileType = (fileName: string): FileType | null => {
  const extension = fileName.split(".").pop()?.toLowerCase();

  return extension ? (FILE_EXTENSION_TO_TYPE[extension] ?? null) : null;
};

/** 知识库文件完整元信息（§7.3）；项目树里用精简的 FileBrief。 */
export const FileMeta = z.object({
  id: Id,
  fileName: z.string(),
  fileType: FileType,
  mimeType: z.string(),
  sizeBytes: Count,
  status: FileStatus,
  errorMessage: z.string().nullable(),
  createdAt: ISODateTime,
});
export type FileMeta = z.infer<typeof FileMeta>;

/* ───────────────────────── 查询参数（§7） ───────────────────────── */

/** 文件列表（§7.3）：分页 + 按解析状态过滤。 */
export const FileListQuery = PaginationQuery.extend({
  status: FileStatus.optional(),
});
export type FileListQuery = z.infer<typeof FileListQuery>;

/** 批量查询解析状态（§7.3）：ids 以逗号分隔，最多 20 个。 */
export const FileIdsQuery = z.object({
  ids: z.preprocess(
    (value) =>
      typeof value === "string"
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : value,
    z.array(Id).min(1).max(20),
  ),
});
export type FileIdsQuery = z.infer<typeof FileIdsQuery>;

/** 批量状态项（§7.3）：stored 为终态。 */
export const FileStatusBrief = z.object({
  id: Id,
  status: FileStatus,
  errorMessage: z.string().nullable(),
});
export type FileStatusBrief = z.infer<typeof FileStatusBrief>;

export const FileStatusResult = z.object({
  items: z.array(FileStatusBrief),
});
export type FileStatusResult = z.infer<typeof FileStatusResult>;
