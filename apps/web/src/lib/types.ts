export type Space = {
  id: string;
  name: string;
  goal: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  counts: {
    sources: number;
    notes: number;
    plan: PlanProgressSummary;
  };
};

export type Source = {
  id: string;
  space_id: string;
  type: string;
  title: string;
  origin: string;
  status:
    | "uploaded"
    | "imported"
    | "queued"
    | "converting"
    | "converted"
    | "chunking"
    | "indexing"
    | "ready"
    | "failed";
  enabled: boolean;
  raw_path?: string | null;
  markdown_path?: string | null;
  version_id?: string | null;
  chunk_count?: number | null;
  indexed_at?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  job_id?: string;
};

export type SourceChunk = {
  id: string;
  source_id: string;
  version_id: string;
  ordinal: number;
  heading_path: string[];
  locator: string;
  text: string;
  content_hash: string;
  char_count: number;
  prev_chunk_id?: string | null;
  next_chunk_id?: string | null;
  embedding_provider: string;
  embedding_model: string;
  embedding_dim: number;
  created_at: string;
};

export type Citation = {
  chunk_id: string;
  source_type: "source" | "note";
  source_id: string;
  source_title: string;
  version_id: string;
  ordinal: number;
  heading_path: string[];
  locator: string;
  quote_snapshot: string;
  score: number;
};

export type RetrievalTrace = {
  original_query: string;
  queries: string[];
  hyde_document?: string | null;
  mqe_used: boolean;
  hyde_used: boolean;
  enhanced_search_used: boolean;
  source_ids?: string[] | null;
  context_count: number;
  insufficient_reason?: string | null;
  memory_context?: MemoryContext[];
};

export type ChatMessage = {
  id: string;
  space_id: string;
  role: "user" | "assistant";
  content: string;
  parent_message_id?: string | null;
  context_snapshot?: Partial<RetrievalTrace>;
  created_at: string;
  citations: Citation[];
};

export type ChatStreamEvent =
  | {
      type: "start";
      user_message: ChatMessage;
      assistant_message: ChatMessage;
    }
  | {
      type: "retrieval";
      message_id: string;
      search: RetrievalTrace;
      citations: Citation[];
    }
  | {
      type: "token";
      message_id: string;
      content: string;
    }
  | {
      type: "done";
      message: ChatMessage;
      search: RetrievalTrace;
      citations: Citation[];
    }
  | {
      type: "error";
      message: string;
    };

export type Note = {
  id: string;
  space_id: string;
  title: string;
  markdown: string;
  tags: string[];
  status: "draft" | "saved" | "fragment";
  source_type?: string | null;
  source_message_id?: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type PlanTaskType = "study" | "review" | "practice" | "note";
export type PlanTaskStatus = "todo" | "in_progress" | "done" | "skipped";
export type PlanTaskPriority = "low" | "medium" | "high";

export type PlanProgressSummary = {
  plan_id?: string | null;
  total_tasks: number;
  done_tasks: number;
  active_tasks?: number;
  review_tasks?: number;
  review_done_tasks?: number;
  overdue_tasks: number;
  progress_percent: number;
  last_completed_at?: string | null;
};

export type PlanTask = {
  id: string;
  space_id: string;
  plan_id: string;
  title: string;
  description: string;
  task_type: PlanTaskType;
  status: PlanTaskStatus;
  priority: PlanTaskPriority;
  due_date?: string | null;
  source_ids: string[];
  review_prompt: string;
  recommended_reason: string;
  order_index: number;
  completed_at?: string | null;
  last_review_message_id?: string | null;
  review_result: string;
  created_at: string;
  updated_at: string;
};

export type LearningPlan = {
  id: string;
  space_id: string;
  title: string;
  goal: string;
  status: "active" | "archived";
  cadence: string;
  target_level: string;
  deadline?: string | null;
  assumptions: Record<string, unknown>;
  rationale: string;
  created_at: string;
  updated_at: string;
  tasks: PlanTask[];
  summary: PlanProgressSummary;
  adjustment_suggestions: string[];
};

export type SearchResult = {
  chunk_id: string;
  source_type: "source" | "note";
  source_id: string;
  source_title: string;
  version_id: string;
  ordinal: number;
  heading_path: string[];
  locator: string;
  quote_snapshot: string;
  score: number;
};

export type MemoryLayerId =
  | "space_profile"
  | "source_semantic"
  | "user_note"
  | "dialogue_episodic"
  | "learning_ability"
  | "preference"
  | "plan_progress";

export type MemorySourceType = "chat" | "note" | "source" | "plan" | "manual";

export type MemoryLayer = {
  id: MemoryLayerId;
  label: string;
  description: string;
};

export type MemorySettings = {
  space_id: string;
  auto_extract_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type MemoryCandidate = {
  id: string;
  space_id: string;
  layer: MemoryLayerId;
  content: string;
  source_type: MemorySourceType;
  source_id?: string | null;
  source_title: string;
  source_excerpt: string;
  confidence: number;
  impact: "low" | "medium" | "high";
  status: "pending" | "accepted" | "ignored";
  accepted_memory_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type MemoryItem = {
  id: string;
  space_id: string;
  layer: MemoryLayerId;
  content: string;
  source_type: MemorySourceType;
  source_id?: string | null;
  source_title: string;
  source_excerpt: string;
  priority: number;
  status: "active" | "deleted";
  candidate_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type MemoryContext = {
  id: string;
  layer: MemoryLayerId;
  content: string;
  source_type: MemorySourceType;
  source_id?: string | null;
  source_title: string;
  priority: number;
  updated_at: string;
};

export type SystemLog = {
  id: number;
  space_id?: string | null;
  level: "debug" | "info" | "warn" | "error";
  category: string;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type ModelProvider = {
  id: string;
  role: "chat" | "embedding";
  display_name: string;
  base_url?: string | null;
  requires_base_url: boolean;
  chat_models: string[];
  embedding_models: string[];
  capabilities: string[];
  configured: boolean;
  has_api_key: boolean;
  status: "not_configured" | "configured" | "connected" | "failed";
  error?: string | null;
  default_chat_model?: string | null;
  default_embedding_model?: string | null;
  last_tested_at?: string | null;
};

export type Health = {
  status: string;
  version: string;
  data_dir: string;
  database_ready: boolean;
  counts: {
    spaces: number;
    sources: number;
    notes: number;
    plans?: number;
    plan_tasks?: number;
  };
};
