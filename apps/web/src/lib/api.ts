import type {
  ChatMessage,
  ChatStreamEvent,
  Health,
  ModelProvider,
  Note,
  Source,
  SourceChunk,
  Space,
  SystemLog,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data = await response.json();
      message = data.detail ?? message;
    } catch {
      // Keep the fallback message.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function readError(response: Response): Promise<string> {
  let message = `Request failed: ${response.status}`;
  try {
    const data = await response.json();
    message = data.detail ?? message;
  } catch {
    // Keep the fallback message.
  }
  return message;
}

export const api = {
  health: () => request<Health>("/health"),

  listProviders: () => request<ModelProvider[]>("/model-providers"),
  saveProvider: (providerId: string, payload: Record<string, unknown>) =>
    request<ModelProvider>(`/model-providers/${providerId}/config`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  testProvider: (providerId: string) =>
    request<ModelProvider>(`/model-providers/${providerId}/test`, {
      method: "POST",
    }),

  listSpaces: (includeArchived = false) =>
    request<Space[]>(`/spaces?include_archived=${includeArchived ? "true" : "false"}`),
  createSpace: (payload: { name: string; goal: string }) =>
    request<Space>("/spaces", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getSpace: (spaceId: string) => request<Space>(`/spaces/${spaceId}`),
  updateSpace: (spaceId: string, payload: Partial<Pick<Space, "name" | "goal" | "status">>) =>
    request<Space>(`/spaces/${spaceId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteSpace: (spaceId: string) =>
    request<{ deleted: boolean; id: string }>(`/spaces/${spaceId}`, {
      method: "DELETE",
    }),

  listSources: (spaceId: string) => request<Source[]>(`/spaces/${spaceId}/sources`),
  uploadSources: (spaceId: string, files: FileList) => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));
    return request<Source[]>(`/spaces/${spaceId}/sources/files`, {
      method: "POST",
      body: formData,
    });
  },
  importUrl: (spaceId: string, payload: { url: string; title?: string }) =>
    request<Source>(`/spaces/${spaceId}/sources/url`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSource: (spaceId: string, sourceId: string, payload: { title?: string; enabled?: boolean }) =>
    request<Source>(`/spaces/${spaceId}/sources/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  retrySource: (spaceId: string, sourceId: string) =>
    request<Source>(`/spaces/${spaceId}/sources/${sourceId}/retry`, {
      method: "POST",
    }),
  deleteSource: (spaceId: string, sourceId: string) =>
    request<{ deleted: boolean; id: string }>(`/spaces/${spaceId}/sources/${sourceId}`, {
      method: "DELETE",
    }),
  getMarkdown: (spaceId: string, sourceId: string) =>
    request<{ source_id: string; title: string; markdown: string }>(
      `/spaces/${spaceId}/sources/${sourceId}/markdown`,
    ),
  getChunks: (spaceId: string, sourceId: string) =>
    request<SourceChunk[]>(`/spaces/${spaceId}/sources/${sourceId}/chunks`),
  search: (spaceId: string, query: string) =>
    request<{ query: string; results: unknown[] }>(
      `/spaces/${spaceId}/search?q=${encodeURIComponent(query)}`,
    ),

  listChatMessages: (spaceId: string) =>
    request<ChatMessage[]>(`/spaces/${spaceId}/chat/messages`),
  streamChat: async (
    spaceId: string,
    payload: {
      question: string;
      source_ids?: string[] | null;
      use_mqe: boolean;
      use_hyde: boolean;
    },
    onEvent: (event: ChatStreamEvent) => void,
  ) => {
    const response = await fetch(`${API_BASE}/spaces/${spaceId}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Streaming response is not available.");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) onEvent(JSON.parse(trimmed) as ChatStreamEvent);
      }
    }
    buffer += decoder.decode();
    const trimmed = buffer.trim();
    if (trimmed) onEvent(JSON.parse(trimmed) as ChatStreamEvent);
  },
  saveChatNote: (spaceId: string, messageId: string, payload: { title?: string } = {}) =>
    request<Note>(`/spaces/${spaceId}/chat/${messageId}/save-note`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  submitChatFeedback: (
    spaceId: string,
    messageId: string,
    payload: { rating: "up" | "down"; issue_type?: string; note?: string },
  ) =>
    request<{ id: string; message_id: string; rating: "up" | "down" }>(
      `/spaces/${spaceId}/chat/${messageId}/feedback`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  listSystemLogs: (payload: { spaceId?: string; afterId?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (payload.spaceId) params.set("space_id", payload.spaceId);
    if (payload.afterId !== undefined) params.set("after_id", String(payload.afterId));
    if (payload.limit !== undefined) params.set("limit", String(payload.limit));
    const suffix = params.toString();
    return request<SystemLog[]>(`/system/logs${suffix ? `?${suffix}` : ""}`);
  },
};
