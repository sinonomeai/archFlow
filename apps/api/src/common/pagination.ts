/** 游标分页：游标对前端不透明，目前编码「排序时间 + 内部 id」。 */
export const encodeCursor = (updatedAt: Date, id: string): string =>
  Buffer.from(`${updatedAt.toISOString()}|${id}`, "utf8").toString("base64url");

export const decodeCursor = (
  cursor: string,
): { updatedAt: Date; id: string } | null => {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");

    if (separator <= 0) {
      return null;
    }

    const updatedAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);

    if (Number.isNaN(updatedAt.getTime()) || !/^\d+$/.test(id)) {
      return null;
    }

    return { updatedAt, id };
  } catch {
    return null;
  }
};
