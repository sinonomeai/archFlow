export const projectQueryKey = ["projects"] as const;

export const conversationQueryKey = (conversationId: string) =>
  ["conversation", conversationId] as const;

export const messagesQueryKey = (conversationId: string) =>
  ["messages", conversationId] as const;

export const activeRunQueryKey = (conversationId: string) =>
  ["active-run", conversationId] as const;
