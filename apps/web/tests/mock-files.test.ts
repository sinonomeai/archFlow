import { mkdtemp, readdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { writeMockJson } from "../lib/mock-files";

const { rename } = vi.hoisted(() => ({
  rename: vi.fn<typeof import("node:fs/promises").rename>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  rename,
}));

const { rename: nativeRename } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const state = z.object({ version: z.number() });
const previous = '{"version":1}';
const fileName = "user.json";
let directory: string;
let target: string;

const createIoError = (code: string) => Object.assign(new Error("Mock file operation failed"), { code });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "archflow-mock-files-"));
  target = join(directory, fileName);
  await writeFile(target, previous, "utf8");
  rename.mockReset();
});

afterEach(async () => {
  for (const name of await readdir(directory)) await unlink(join(directory, name));
  await rmdir(directory);
});

it.runIf(process.platform === "win32")("atomically retries a transient destination sharing failure", async () => {
  rename.mockImplementationOnce(async (source, destination) => {
    expect(await readFile(destination, "utf8")).toBe(previous);
    expect(await readFile(source, "utf8")).toContain('"version": 2');
    throw createIoError("EPERM");
  });
  rename.mockImplementation(nativeRename);

  await writeMockJson(target, state, { version: 2 });

  expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ version: 2 });
  expect(await readdir(directory)).toEqual([fileName]);
  expect(rename).toHaveBeenCalledTimes(2);
  expect(rename.mock.calls[0]).toEqual(rename.mock.calls[1]);
});

it.runIf(process.platform === "win32")("propagates a persistent sharing failure after a finite retry budget", async () => {
  const failure = createIoError("EBUSY");
  rename.mockRejectedValue(failure);

  await expect(writeMockJson(target, state, { version: 2 })).rejects.toBe(failure);

  expect(rename).toHaveBeenCalledTimes(6);
  expect(await readFile(target, "utf8")).toBe(previous);
  expect(await readdir(directory)).toEqual([fileName]);
});

it.each(["EACCES", "ENOSPC"])("propagates %s while preserving the original file", async (code) => {
  const failure = createIoError(code);
  rename.mockRejectedValue(failure);

  await expect(writeMockJson(target, state, { version: 2 })).rejects.toBe(failure);

  expect(rename).toHaveBeenCalledTimes(1);
  expect(await readFile(target, "utf8")).toBe(previous);
  expect(await readdir(directory)).toEqual([fileName]);
});
