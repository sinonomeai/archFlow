import type { Message } from "@arch-flow/shared";
import { expect, it } from "vitest";
import { mergeMessageHistory } from "../preview/hooks/use-messages";

const message = (id: string, content = id): Message => ({
  id,
  role: "assistant",
  content,
  graphSnapshot: null,
  metadata: null,
  createdAt: "2026-11-23T12:00:00Z",
});

it("keeps loaded history and displaced recent rows when the latest page advances", () => {
  const historicalGraph = {
    ...message("first"),
    graphSnapshot: { nodes: [], edges: [] },
  };
  const previouslyRecent = message("second");
  const newerVersion = message("third", "final assistant text");
  const newestMessage = message("fourth");
  const loadedWindow = mergeMessageHistory(
    [historicalGraph, previouslyRecent],
    [previouslyRecent, message("third", "streaming assistant text")],
  );

  expect(
    mergeMessageHistory(loadedWindow, [newerVersion, newestMessage]),
  ).toEqual([historicalGraph, previouslyRecent, newerVersion, newestMessage]);
});
