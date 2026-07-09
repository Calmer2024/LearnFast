export type Space = {
  id: string;
  name: string;
  goal: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  counts: {
    sources: number;
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
  status: string;
  source_type?: string | null;
  source_message_id?: string | null;
  created_at: string;
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
  };
};
