/**
 * 文件类型白名单的唯一来源在 @arch-flow/shared；
 * 这里保留本地出口，避免前端各处直接依赖 shared 的深层路径。
 */
export {
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_FILE_ACCEPT,
  resolveFileType,
} from "@arch-flow/shared";
