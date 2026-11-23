import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import type { z } from "zod";

const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 25, 50, 100, 200];

const mockFiles = globalThis as typeof globalThis & {
  archFlowMockFileWrites?: Map<string, Promise<void>>;
};

export const getMockDir = () =>
  path.resolve(process.env.ARCHFLOW_MOCK_DIR || path.join(process.cwd(), ".mock"));

export const withMockFileWrite = async <T>(
  filePath: string,
  mutate: () => Promise<T>,
): Promise<T> => {
  const queue = (mockFiles.archFlowMockFileWrites ??= new Map());
  const previous = queue.get(filePath);
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.set(filePath, current);
  await previous;

  try {
    return await mutate();
  } finally {
    release();
    if (queue.get(filePath) === current) queue.delete(filePath);
  }
};

export const readMockJson = async <T>(
  filePath: string,
  schema: z.ZodType<T>,
  fallback: () => T,
): Promise<T> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return fallback();
    }
    throw error;
  }

  return schema.parse(JSON.parse(raw));
};

const replaceMockJson = async (temporaryPath: string, filePath: string): Promise<void> => {
  for (const delayMs of WINDOWS_RENAME_RETRY_DELAYS_MS) {
    try {
      await rename(temporaryPath, filePath);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "EPERM" && error.code !== "EBUSY")
      ) {
        throw error;
      }
    }

    await wait(delayMs);
  }

  await rename(temporaryPath, filePath);
};

export const writeMockJson = async <T>(
  filePath: string,
  schema: z.ZodType<T>,
  value: T,
): Promise<void> => {
  const data = schema.parse(value);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await replaceMockJson(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT")) {
        console.error("Failed to clean up a temporary Mock file");
      }
    }
    throw error;
  }
};
