import type {
  ChatMessage,
  ChatStreamEvent,
  Health,
  LearningPlan,
  LearningPreferences,
  LearningReport,
  MemoryCandidate,
  MemoryItem,
  MemoryLayer,
  MemoryLayerId,
  MemorySettings,
  MemorySourceType,
  ModelProvider,
  Note,
  PlanTask,
  PlanTaskPriority,
  PlanTaskStatus,
  PlanTaskType,
  SearchResult,
  Source,
  SourceFolder,
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
  listSourceFolders: (spaceId: string) => request<SourceFolder[]>(`/spaces/${spaceId}/source-folders`),
  createSourceFolder: (spaceId: string, payload: { name: string; parent_id?: string | null }) =>
    request<SourceFolder>(`/spaces/${spaceId}/source-folders`, { method: "POST", body: JSON.stringify(payload) }),
  updateSourceFolder: (spaceId: string, folderId: string, payload: { name?: string; parent_id?: string | null }) =>
    request<SourceFolder>(`/spaces/${spaceId}/source-folders/${folderId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSourceFolder: (spaceId: string, folderId: string) =>
    request<{ deleted: boolean; id: string }>(`/spaces/${spaceId}/source-folders/${folderId}`, { method: "DELETE" }),
  uploadSources: (spaceId: string, files: FileList | File[], folderId?: string | null) => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));
    if (folderId) formData.append("folder_id", folderId);
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
  updateSource: (spaceId: string, sourceId: string, payload: { title?: string; enabled?: boolean; folder_id?: string | null }) =>
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
  getLearningPreferences: (spaceId: string) =>
    request<LearningPreferences>(`/spaces/${spaceId}/learning-preferences`),
  updateLearningPreferences: (spaceId: string, payload: Omit<LearningPreferences, "space_id">) =>
    request<LearningPreferences>(`/spaces/${spaceId}/learning-preferences`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  getChunks: (spaceId: string, sourceId: string) =>
    request<SourceChunk[]>(`/spaces/${spaceId}/sources/${sourceId}/chunks`),
  search: (spaceId: string, query: string) =>
    request<{ query: string; results: SearchResult[] }>(
      `/spaces/${spaceId}/search?q=${encodeURIComponent(query)}`,
    ),
  exportSpaceMarkdown: (spaceId: string) =>
    request<{ space_id: string; title: string; markdown: string; metadata: Record<string, number> }>(
      `/spaces/${spaceId}/export`,
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
  listNotes: (spaceId: string, params: { q?: string; tag?: string } = {}) => {
    const searchParams = new URLSearchParams();
    if (params.q) searchParams.set("q", params.q);
    if (params.tag) searchParams.set("tag", params.tag);
    const suffix = searchParams.toString();
    return request<Note[]>(`/spaces/${spaceId}/notes${suffix ? `?${suffix}` : ""}`);
  },
  createNote: (
    spaceId: string,
    payload: {
      title?: string;
      markdown: string;
      tags?: string[];
      status?: "draft" | "saved" | "fragment";
    },
  ) =>
    request<Note>(`/spaces/${spaceId}/notes`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  uploadNotes: (spaceId: string, files: FileList | File[]) => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));
    return request<Note[]>(`/spaces/${spaceId}/notes/files`, {
      method: "POST",
      body: formData,
    });
  },
  updateNote: (
    spaceId: string,
    noteId: string,
    payload: Partial<{
      title: string;
      markdown: string;
      tags: string[];
      status: "draft" | "saved" | "fragment";
    }>,
  ) =>
    request<Note>(`/spaces/${spaceId}/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteNote: (spaceId: string, noteId: string, deleteAssociatedMemories: boolean) =>
    request<{
      deleted: boolean;
      id: string;
      delete_associated_memories: boolean;
      memory_delete_result?: { deleted_memories: number; ignored_candidates: number } | null;
    }>(
      `/spaces/${spaceId}/notes/${noteId}?delete_associated_memories=${deleteAssociatedMemories ? "true" : "false"}`,
      {
        method: "DELETE",
      },
    ),
  exportNoteMarkdown: (spaceId: string, noteId: string) =>
    request<{ note_id: string; title: string; markdown: string }>(
      `/spaces/${spaceId}/notes/${noteId}/export`,
    ),
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

  getCurrentPlan: (spaceId: string) =>
    request<LearningPlan | null>(`/spaces/${spaceId}/plans/current`),
  createPlan: (
    spaceId: string,
    payload: {
      title?: string;
      goal: string;
      cadence?: string;
      target_level?: string;
      deadline?: string | null;
      assumptions?: Record<string, unknown>;
      rationale?: string;
      tasks?: Partial<PlanTask>[];
      replace_current?: boolean;
    },
  ) =>
    request<LearningPlan>(`/spaces/${spaceId}/plans`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  generatePlan: (
    spaceId: string,
    payload: {
      goal?: string;
      cadence: string;
      target_level: string;
      deadline?: string | null;
      replace_current?: boolean;
    },
  ) =>
    request<LearningPlan>(`/spaces/${spaceId}/plans/generate`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePlan: (
    spaceId: string,
    planId: string,
    payload: Partial<{
      title: string;
      goal: string;
      status: "active" | "archived";
      cadence: string;
      target_level: string;
      deadline: string | null;
    }>,
  ) =>
    request<LearningPlan>(`/spaces/${spaceId}/plans/${planId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  createPlanTask: (
    spaceId: string,
    planId: string,
    payload: {
      title: string;
      description?: string;
      task_type?: PlanTaskType;
      status?: PlanTaskStatus;
      priority?: PlanTaskPriority;
      due_date?: string | null;
      source_ids?: string[];
      review_prompt?: string;
      recommended_reason?: string;
    },
  ) =>
    request<LearningPlan>(`/spaces/${spaceId}/plans/${planId}/tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePlanTask: (
    spaceId: string,
    planId: string,
    taskId: string,
    payload: Partial<{
      title: string;
      description: string;
      task_type: PlanTaskType;
      status: PlanTaskStatus;
      priority: PlanTaskPriority;
      due_date: string | null;
      source_ids: string[];
      review_prompt: string;
      recommended_reason: string;
      order_index: number;
    }>,
  ) =>
    request<LearningPlan>(`/spaces/${spaceId}/plans/${planId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  completePlanTask: (
    spaceId: string,
    planId: string,
    taskId: string,
    payload: { review_result?: string; message_id?: string } = {},
  ) =>
    request<LearningPlan>(`/spaces/${spaceId}/plans/${planId}/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  recordPlanReviewResult: (
    spaceId: string,
    planId: string,
    taskId: string,
    payload: { result: string; message_id?: string; mark_completed?: boolean },
  ) =>
    request<LearningPlan>(`/spaces/${spaceId}/plans/${planId}/tasks/${taskId}/review-result`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deletePlanTask: (spaceId: string, planId: string, taskId: string) =>
    request<LearningPlan>(`/spaces/${spaceId}/plans/${planId}/tasks/${taskId}`, {
      method: "DELETE",
    }),
  exportPlanMarkdown: (spaceId: string, planId: string) =>
    request<{ plan_id: string; title: string; markdown: string }>(
      `/spaces/${spaceId}/plans/${planId}/export`,
    ),

  listReports: (spaceId: string) =>
    request<LearningReport[]>(`/spaces/${spaceId}/reports`),
  generateReport: (
    spaceId: string,
    payload: {
      range_start?: string | null;
      range_end?: string | null;
      source_ids?: string[];
      include_notes?: boolean;
      include_memories?: boolean;
      title?: string;
    },
  ) =>
    request<LearningReport>(`/spaces/${spaceId}/reports/generate`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getReport: (spaceId: string, reportId: string) =>
    request<LearningReport>(`/spaces/${spaceId}/reports/${reportId}`),
  saveReportNote: (spaceId: string, reportId: string, payload: { title?: string } = {}) =>
    request<{ report: LearningReport; note: Note }>(
      `/spaces/${spaceId}/reports/${reportId}/save-note`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  exportReportMarkdown: (spaceId: string, reportId: string) =>
    request<{ report_id: string; title: string; markdown: string }>(
      `/spaces/${spaceId}/reports/${reportId}/export`,
    ),

  listMemoryLayers: () => request<MemoryLayer[]>("/memory-layers"),
  getMemorySettings: (spaceId: string) =>
    request<MemorySettings>(`/spaces/${spaceId}/memory-settings`),
  updateMemorySettings: (spaceId: string, payload: { auto_extract_enabled: boolean }) =>
    request<MemorySettings>(`/spaces/${spaceId}/memory-settings`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  listMemoryCandidates: (
    spaceId: string,
    params: { status?: "pending" | "accepted" | "ignored" | "all"; layer?: MemoryLayerId | "" } = {},
  ) => {
    const searchParams = new URLSearchParams();
    searchParams.set("status", params.status ?? "pending");
    if (params.layer) searchParams.set("layer", params.layer);
    return request<MemoryCandidate[]>(
      `/spaces/${spaceId}/memory-candidates?${searchParams.toString()}`,
    );
  },
  updateMemoryCandidate: (
    spaceId: string,
    candidateId: string,
    payload: Partial<{
      content: string;
      layer: MemoryLayerId;
      impact: "low" | "medium" | "high";
    }>,
  ) =>
    request<MemoryCandidate>(`/spaces/${spaceId}/memory-candidates/${candidateId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  confirmMemoryCandidate: (
    spaceId: string,
    candidateId: string,
    payload: Partial<{ content: string; layer: MemoryLayerId }> = {},
  ) =>
    request<MemoryItem>(`/spaces/${spaceId}/memory-candidates/${candidateId}/confirm`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ignoreMemoryCandidate: (spaceId: string, candidateId: string) =>
    request<MemoryCandidate>(`/spaces/${spaceId}/memory-candidates/${candidateId}/ignore`, {
      method: "POST",
    }),
  listMemories: (
    spaceId: string,
    params: { layer?: MemoryLayerId | ""; include_deleted?: boolean } = {},
  ) => {
    const searchParams = new URLSearchParams();
    if (params.layer) searchParams.set("layer", params.layer);
    if (params.include_deleted) searchParams.set("include_deleted", "true");
    const suffix = searchParams.toString();
    return request<MemoryItem[]>(`/spaces/${spaceId}/memories${suffix ? `?${suffix}` : ""}`);
  },
  createMemory: (
    spaceId: string,
    payload: {
      layer: MemoryLayerId;
      content: string;
      source_type?: MemorySourceType;
      source_id?: string | null;
      source_title?: string;
      source_excerpt?: string;
      priority?: number;
    },
  ) =>
    request<MemoryItem>(`/spaces/${spaceId}/memories`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateMemory: (
    spaceId: string,
    memoryId: string,
    payload: Partial<{ content: string; layer: MemoryLayerId; priority: number }>,
  ) =>
    request<MemoryItem>(`/spaces/${spaceId}/memories/${memoryId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteMemory: (spaceId: string, memoryId: string) =>
    request<{ deleted: boolean; id: string }>(`/spaces/${spaceId}/memories/${memoryId}`, {
      method: "DELETE",
    }),

  listSystemLogs: (payload: { spaceId?: string; afterId?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (payload.spaceId) params.set("space_id", payload.spaceId);
    if (payload.afterId !== undefined) params.set("after_id", String(payload.afterId));
    if (payload.limit !== undefined) params.set("limit", String(payload.limit));
    const suffix = params.toString();
    return request<SystemLog[]>(`/system/logs${suffix ? `?${suffix}` : ""}`);
  },
};
