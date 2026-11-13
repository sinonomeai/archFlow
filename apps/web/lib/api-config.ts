/** 前后端共享的 API 根地址；本地默认指向 Nest。 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:3001/api/v1";

export const apiUrl = (path: string): string => {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  /** 服务端返回的 streamUrl 已带 /api/v1，避免与 API_BASE_URL 重复。 */
  const normalized = path.startsWith("/api/v1")
    ? path.slice("/api/v1".length)
    : path;

  return `${API_BASE_URL}${
    normalized.startsWith("/") ? normalized : `/${normalized}`
  }`;
};
