const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

/** 按字符切片；保留段落边界，块间重叠 100 字符。 */
export const chunkText = (content: string): string[] => {
  const normalized = content.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    const slice = normalized.slice(start, end).trim();

    if (slice) {
      chunks.push(slice);
    }

    if (end === normalized.length) {
      break;
    }

    start = end - CHUNK_OVERLAP;
  }

  return chunks;
};
