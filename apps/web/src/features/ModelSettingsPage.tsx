import { FloppyDisk, Plug } from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { ModelProvider } from "../lib/types";

type Draft = {
  api_key: string;
  base_url: string;
  default_chat_model: string;
  default_embedding_model: string;
};

export function ModelSettingsPage() {
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const rows = await api.listProviders();
    setProviders(rows);
    setDrafts((current) => {
      const next = { ...current };
      rows.forEach((provider) => {
        next[provider.id] = next[provider.id] ?? {
          api_key: "",
          base_url: provider.base_url ?? "",
          default_chat_model: provider.default_chat_model ?? provider.chat_models[0] ?? "",
          default_embedding_model:
            provider.default_embedding_model ?? provider.embedding_models[0] ?? "",
        };
      });
      return next;
    });
  };

  useEffect(() => {
    load().catch((exc) => setError(exc.message));
  }, []);

  const chatProvider = useMemo(
    () => providers.find((provider) => provider.role === "chat") ?? null,
    [providers],
  );
  const embeddingProvider = useMemo(
    () => providers.find((provider) => provider.role === "embedding") ?? null,
    [providers],
  );

  const updateDraft = (providerId: string, field: keyof Draft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [providerId]: {
        ...current[providerId],
        [field]: value,
      },
    }));
  };

  const save = async (event: FormEvent, provider: ModelProvider) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      const draft = drafts[provider.id];
      await api.saveProvider(provider.id, {
        api_key: draft.api_key || undefined,
        base_url: draft.base_url || undefined,
        default_chat_model:
          provider.role === "chat" ? draft.default_chat_model || undefined : undefined,
        default_embedding_model:
          provider.role === "embedding"
            ? draft.default_embedding_model || undefined
            : undefined,
      });
      setMessage(`${provider.display_name} 已保存。`);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "保存失败");
    }
  };

  const test = async (provider: ModelProvider) => {
    setMessage(null);
    setError(null);
    try {
      const result = await api.testProvider(provider.id);
      setMessage(`${provider.display_name} 测试结果：${result.status}`);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "测试失败");
    }
  };

  return (
    <main className="page narrow">
      <section className="page-header">
        <div>
          <p className="eyebrow">BYOK</p>
          <h1>模型设置</h1>
        </div>
      </section>

      <div className="notice">
        聊天模型和向量模型分开配置，可以使用不同 provider。当前聊天模型只支持 DeepSeek，向量模型只支持 Qwen text-embedding-v4。
      </div>
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice danger">{error}</div>}

      <section className="provider-list">
        {chatProvider && drafts[chatProvider.id] && (
          <ProviderPanel
            description="用于学习问答、计划生成、报告生成、记忆提取等文本生成任务。"
            draft={drafts[chatProvider.id]}
            modelLabel="聊天模型"
            modelOptions={chatProvider.chat_models}
            modelValue={drafts[chatProvider.id].default_chat_model}
            onModelChange={(value) =>
              updateDraft(chatProvider.id, "default_chat_model", value)
            }
            onSave={save}
            onTest={test}
            onUpdateDraft={updateDraft}
            provider={chatProvider}
          />
        )}

        {embeddingProvider && drafts[embeddingProvider.id] && (
          <ProviderPanel
            description="用于资料分块向量化、RAG 检索和相似度召回。该配置不会用于聊天生成。"
            draft={drafts[embeddingProvider.id]}
            modelLabel="向量模型"
            modelOptions={embeddingProvider.embedding_models}
            modelValue={drafts[embeddingProvider.id].default_embedding_model}
            onModelChange={(value) =>
              updateDraft(embeddingProvider.id, "default_embedding_model", value)
            }
            onSave={save}
            onTest={test}
            onUpdateDraft={updateDraft}
            provider={embeddingProvider}
          />
        )}
      </section>
    </main>
  );
}

type ProviderPanelProps = {
  description: string;
  draft: Draft;
  modelLabel: string;
  modelOptions: string[];
  modelValue: string;
  provider: ModelProvider;
  onModelChange: (value: string) => void;
  onSave: (event: FormEvent, provider: ModelProvider) => void;
  onTest: (provider: ModelProvider) => void;
  onUpdateDraft: (providerId: string, field: keyof Draft, value: string) => void;
};

function ProviderPanel({
  description,
  draft,
  modelLabel,
  modelOptions,
  modelValue,
  provider,
  onModelChange,
  onSave,
  onTest,
  onUpdateDraft,
}: ProviderPanelProps) {
  return (
    <form className="panel provider-panel" onSubmit={(event) => onSave(event, provider)}>
      <div className="card-header">
        <div>
          <p className="eyebrow">{provider.role === "chat" ? "Chat Model" : "Embedding Model"}</p>
          <h2>{provider.display_name}</h2>
          <p>{description}</p>
        </div>
        <StatusBadge status={provider.status} />
      </div>
      {provider.error && <div className="notice danger">{provider.error}</div>}
      <div className="form-grid">
        <label>
          API Key
          <input
            type="password"
            value={draft.api_key}
            onChange={(event) => onUpdateDraft(provider.id, "api_key", event.target.value)}
            placeholder={provider.has_api_key ? "已保存，留空表示不修改" : "输入用户自带密钥"}
          />
        </label>
        <label>
          Base URL
          <input
            value={draft.base_url}
            onChange={(event) => onUpdateDraft(provider.id, "base_url", event.target.value)}
            placeholder={
              provider.role === "embedding"
                ? "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
                : "https://api.deepseek.com"
            }
          />
        </label>
        <label>
          {modelLabel}
          <input
            list={`${provider.id}-models`}
            value={modelValue}
            onChange={(event) => onModelChange(event.target.value)}
          />
          <datalist id={`${provider.id}-models`}>
            {modelOptions.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="card-actions">
        <button className="button">
          <FloppyDisk size={15} />
          保存配置
        </button>
        <button className="button secondary" type="button" onClick={() => onTest(provider)}>
          <Plug size={15} />
          连接测试
        </button>
      </div>
    </form>
  );
}
