import {
  Brain,
  CheckCircle,
  FloppyDisk,
  PencilSimple,
  Plus,
  Trash,
  XCircle,
} from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { useAppDialog } from "../../components/AppDialog";
import { CustomSelect, type CustomSelectOption } from "../../components/CustomSelect";
import { api } from "../../lib/api";
import type {
  MemoryCandidate,
  MemoryItem,
  MemoryLayer,
  MemoryLayerId,
  MemorySettings,
  MemorySourceType,
} from "../../lib/types";

type CandidateStatus = "pending" | "accepted" | "ignored" | "all";
type MemoryView = "candidates" | "memories" | "manual" | "settings";

const sourceLabels: Record<MemorySourceType, string> = {
  chat: "对话",
  note: "笔记",
  source: "资料",
  plan: "计划",
  manual: "手动",
};

const impactLabels: Record<MemoryCandidate["impact"], string> = {
  low: "低影响",
  medium: "中影响",
  high: "高影响",
};

const candidateStatusOptions: CustomSelectOption<CandidateStatus>[] = [
  { value: "pending", label: "待处理" },
  { value: "accepted", label: "已确认" },
  { value: "ignored", label: "已忽略" },
  { value: "all", label: "全部候选" },
];

const impactOptions: CustomSelectOption<MemoryCandidate["impact"]>[] = [
  { value: "low", label: "低影响" },
  { value: "medium", label: "中影响" },
  { value: "high", label: "高影响" },
];

export function MemoriesSection({ spaceId }: { spaceId: string }) {
  const dialog = useAppDialog();
  const [memoryView, setMemoryView] = useState<MemoryView>("candidates");
  const [layers, setLayers] = useState<MemoryLayer[]>([]);
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [layerFilter, setLayerFilter] = useState<MemoryLayerId | "">("");
  const [candidateStatus, setCandidateStatus] = useState<CandidateStatus>("pending");
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);
  const [candidateDraft, setCandidateDraft] = useState("");
  const [candidateLayerDraft, setCandidateLayerDraft] = useState<MemoryLayerId>("user_note");
  const [candidateImpactDraft, setCandidateImpactDraft] = useState<MemoryCandidate["impact"]>("medium");
  const [manualContent, setManualContent] = useState("");
  const [manualLayer, setManualLayer] = useState<MemoryLayerId>("space_profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const layerById = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer])),
    [layers],
  );
  const layerOptions = useMemo<CustomSelectOption<MemoryLayerId>[]>(
    () => layers.map((layer) => ({ value: layer.id, label: layer.label })),
    [layers],
  );
  const layerFilterOptions = useMemo<CustomSelectOption<MemoryLayerId | "">[]>(
    () => [{ value: "", label: "全部七层" }, ...layerOptions],
    [layerOptions],
  );
  const highImpactCount = useMemo(
    () => candidates.filter((candidate) => candidate.impact === "high").length,
    [candidates],
  );

  const loadMemories = async () => {
    const [layerRows, settingsRow, candidateRows, memoryRows] = await Promise.all([
      api.listMemoryLayers(),
      api.getMemorySettings(spaceId),
      api.listMemoryCandidates(spaceId, {
        status: candidateStatus,
        layer: layerFilter,
      }),
      api.listMemories(spaceId, { layer: layerFilter }),
    ]);
    setLayers(layerRows);
    setSettings(settingsRow);
    setCandidates(candidateRows);
    setMemories(memoryRows);
  };

  useEffect(() => {
    loadMemories().catch((exc) =>
      setError(exc instanceof Error ? exc.message : "记忆加载失败"),
    );
  }, [spaceId, layerFilter, candidateStatus]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await loadMemories();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "记忆操作失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoExtract = async () => {
    if (!settings) return;
    await runAction(async () => {
      const next = await api.updateMemorySettings(spaceId, {
        auto_extract_enabled: !settings.auto_extract_enabled,
      });
      setSettings(next);
      setNotice(next.auto_extract_enabled ? "已开启自动记忆提取。" : "已关闭自动记忆提取。");
    });
  };

  const startEditCandidate = (candidate: MemoryCandidate) => {
    setEditingCandidateId(candidate.id);
    setCandidateDraft(candidate.content);
    setCandidateLayerDraft(candidate.layer);
    setCandidateImpactDraft(candidate.impact);
    setError(null);
    setNotice(null);
  };

  const cancelEditCandidate = () => {
    setEditingCandidateId(null);
    setCandidateDraft("");
  };

  const saveCandidateDraft = async (candidate: MemoryCandidate) => {
    await runAction(async () => {
      await api.updateMemoryCandidate(spaceId, candidate.id, {
        content: candidateDraft,
        layer: candidateLayerDraft,
        impact: candidateImpactDraft,
      });
      cancelEditCandidate();
      setNotice("记忆候选已改写。");
    });
  };

  const confirmCandidate = async (candidate: MemoryCandidate) => {
    await runAction(async () => {
      const isEditing = editingCandidateId === candidate.id;
      await api.confirmMemoryCandidate(spaceId, candidate.id, {
        content: isEditing ? candidateDraft : undefined,
        layer: isEditing ? candidateLayerDraft : undefined,
      });
      cancelEditCandidate();
      setNotice("记忆已确认进入长期记忆。");
    });
  };

  const ignoreCandidate = async (candidate: MemoryCandidate) => {
    await runAction(async () => {
      await api.ignoreMemoryCandidate(spaceId, candidate.id);
      setNotice("候选已忽略。");
    });
  };

  const createManualMemory = async (event: FormEvent) => {
    event.preventDefault();
    const content = manualContent.trim();
    if (!content) return;
    await runAction(async () => {
      await api.createMemory(spaceId, {
        layer: manualLayer,
        content,
        source_type: "manual",
        source_title: "手动记忆",
        source_excerpt: content,
        priority: 1,
      });
      setManualContent("");
      setNotice("手动记忆已创建。");
    });
  };

  const deleteMemory = async (memory: MemoryItem) => {
    const confirmed = await dialog.confirm({
      title: "删除这条长期记忆？",
      body: memory.content,
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!confirmed) return;
    await runAction(async () => {
      await api.deleteMemory(spaceId, memory.id);
      setNotice("长期记忆已删除，新问答不会再使用它。");
    });
  };

  return (
    <div className="memories-layout">
      <section className="memories-main">
        <section className="memories-header">
          <div>
            <p className="eyebrow">Memory Control</p>
            <h2>记忆</h2>
          </div>
          <button className="button secondary" type="button" onClick={() => setMemoryView("settings")} disabled={busy || !settings}>
            <Brain size={15} />
            记忆设置
          </button>
        </section>

        {error && <div className="notice danger">{error}</div>}
        {notice && <div className="notice success">{notice}</div>}

        <section className="memory-overview">
          <div>
            <span>候选</span>
            <strong>{candidates.length}</strong>
          </div>
          <div>
            <span>高影响候选</span>
            <strong>{highImpactCount}</strong>
          </div>
          <div>
            <span>长期记忆</span>
            <strong>{memories.length}</strong>
          </div>
        </section>

        <section className="memory-controls">
          <label>
            记忆层
            <CustomSelect value={layerFilter} options={layerFilterOptions} onChange={setLayerFilter} />
          </label>
          <label>
            候选状态
            <CustomSelect value={candidateStatus} options={candidateStatusOptions} onChange={setCandidateStatus} />
          </label>
        </section>

        <div className="context-tabs memory-tabs" role="tablist" aria-label="记忆面板视图">
          <button
            className={memoryView === "candidates" ? "active" : ""}
            onClick={() => setMemoryView("candidates")}
            type="button"
          >
            候选治理
          </button>
          <button
            className={memoryView === "memories" ? "active" : ""}
            onClick={() => setMemoryView("memories")}
            type="button"
          >
            长期记忆
          </button>
          <button
            className={memoryView === "manual" ? "active" : ""}
            onClick={() => setMemoryView("manual")}
            type="button"
          >
            手动添加
          </button>
          <button
            className={memoryView === "settings" ? "active" : ""}
            onClick={() => setMemoryView("settings")}
            type="button"
          >
            设置
          </button>
        </div>

        <section className="memory-stage">
          {memoryView === "candidates" && (
            <div className="memory-column single">
              <div className="section-header compact">
                <div>
                  <p className="eyebrow">Candidates</p>
                  <h3>记忆候选</h3>
                </div>
              </div>
              <div className="memory-card-list">
                {candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    layerOptions={layerOptions}
                    layerLabel={layerById.get(candidate.layer)?.label ?? candidate.layer}
                    editing={editingCandidateId === candidate.id}
                    draft={candidateDraft}
                    draftLayer={candidateLayerDraft}
                    draftImpact={candidateImpactDraft}
                    busy={busy}
                    onEdit={() => startEditCandidate(candidate)}
                    onCancel={cancelEditCandidate}
                    onDraftChange={setCandidateDraft}
                    onDraftLayerChange={setCandidateLayerDraft}
                    onDraftImpactChange={setCandidateImpactDraft}
                    onSave={() => saveCandidateDraft(candidate)}
                    onConfirm={() => confirmCandidate(candidate)}
                    onIgnore={() => ignoreCandidate(candidate)}
                  />
                ))}
                {candidates.length === 0 && (
                  <div className="empty memory-empty">
                    <h3>暂无候选</h3>
                    <p>新的对话或笔记保存后，会在这里出现可治理的记忆候选。</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {memoryView === "memories" && (
            <div className="memory-column single">
              <div className="section-header compact">
                <div>
                  <p className="eyebrow">Long Term</p>
                  <h3>长期记忆</h3>
                </div>
              </div>
              <div className="memory-card-list">
                {memories.map((memory) => (
                  <article className="memory-card" key={memory.id}>
                    <div className="memory-card-head">
                      <span className="memory-layer-pill">{layerById.get(memory.layer)?.label ?? memory.layer}</span>
                      <span className="memory-source">{sourceLabels[memory.source_type]}</span>
                    </div>
                    <p>{memory.content}</p>
                    <SourceBlock
                      title={memory.source_title}
                      excerpt={memory.source_excerpt}
                      createdAt={memory.updated_at}
                    />
                    <div className="memory-actions">
                      <span className="memory-priority">优先级 {memory.priority}</span>
                      <button className="button ghost danger-text" type="button" onClick={() => deleteMemory(memory)} disabled={busy}>
                        <Trash size={15} />
                        删除
                      </button>
                    </div>
                  </article>
                ))}
                {memories.length === 0 && (
                  <div className="empty memory-empty">
                    <h3>暂无长期记忆</h3>
                    <p>确认候选或手动添加后，长期记忆会参与当前空间的新问答。</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {memoryView === "manual" && (
            <form className="manual-memory-form expanded" onSubmit={createManualMemory}>
              <label>
                手动记忆层
                <CustomSelect
                  value={manualLayer}
                  options={layerOptions}
                  onChange={setManualLayer}
                  disabled={layerOptions.length === 0}
                  placeholder="暂无记忆层"
                />
              </label>
              <textarea
                rows={5}
                value={manualContent}
                onChange={(event) => setManualContent(event.target.value)}
                placeholder="例如：这个空间的目标是两周内复习完 Pandas 数据清洗。"
              />
              <button className="button" disabled={busy || !manualContent.trim()}>
                <Plus size={15} />
                添加记忆
              </button>
            </form>
          )}

          {memoryView === "settings" && (
            <section className="panel memory-settings-panel">
              <p className="eyebrow">Settings</p>
              <h3>自动提取</h3>
              <p className="muted">开启后，对话和笔记会生成候选，不会直接进入长期记忆。</p>
              <button className="button secondary" type="button" onClick={toggleAutoExtract} disabled={busy || !settings}>
                <Brain size={15} />
                {settings?.auto_extract_enabled ? "自动提取：开" : "自动提取：关"}
              </button>
            </section>
          )}
        </section>
      </section>
      {dialog.node}
    </div>
  );
}

function CandidateCard({
  candidate,
  layerOptions,
  layerLabel,
  editing,
  draft,
  draftLayer,
  draftImpact,
  busy,
  onEdit,
  onCancel,
  onDraftChange,
  onDraftLayerChange,
  onDraftImpactChange,
  onSave,
  onConfirm,
  onIgnore,
}: {
  candidate: MemoryCandidate;
  layerOptions: CustomSelectOption<MemoryLayerId>[];
  layerLabel: string;
  editing: boolean;
  draft: string;
  draftLayer: MemoryLayerId;
  draftImpact: MemoryCandidate["impact"];
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onDraftLayerChange: (value: MemoryLayerId) => void;
  onDraftImpactChange: (value: MemoryCandidate["impact"]) => void;
  onSave: () => void;
  onConfirm: () => void;
  onIgnore: () => void;
}) {
  return (
    <article className={`memory-card ${candidate.impact === "high" ? "high-impact" : ""}`}>
      <div className="memory-card-head">
        <span className="memory-layer-pill">{layerLabel}</span>
        <span className={`impact-pill impact-${candidate.impact}`}>{impactLabels[candidate.impact]}</span>
        <span className="memory-source">{sourceLabels[candidate.source_type]}</span>
      </div>

      {editing ? (
        <div className="candidate-editor">
          <textarea rows={4} value={draft} onChange={(event) => onDraftChange(event.target.value)} />
          <div className="candidate-editor-grid">
            <label>
              记忆层
              <CustomSelect
                value={draftLayer}
                options={layerOptions}
                onChange={onDraftLayerChange}
                disabled={layerOptions.length === 0}
                placeholder="暂无记忆层"
              />
            </label>
            <label>
              影响
              <CustomSelect value={draftImpact} options={impactOptions} onChange={onDraftImpactChange} />
            </label>
          </div>
        </div>
      ) : (
        <p>{candidate.content}</p>
      )}

      <SourceBlock
        title={candidate.source_title}
        excerpt={candidate.source_excerpt}
        createdAt={candidate.created_at}
      />

      <div className="memory-actions">
        <span className="memory-confidence">置信度 {Math.round(candidate.confidence * 100)}%</span>
        {editing ? (
          <>
            <button className="button ghost" type="button" onClick={onCancel} disabled={busy}>
              <XCircle size={15} />
              取消
            </button>
            <button className="button ghost" type="button" onClick={onSave} disabled={busy || !draft.trim()}>
              <FloppyDisk size={15} />
              保存改写
            </button>
          </>
        ) : (
          <button className="button ghost" type="button" onClick={onEdit} disabled={busy || candidate.status !== "pending"}>
            <PencilSimple size={15} />
            改写
          </button>
        )}
        <button className="button ghost" type="button" onClick={onIgnore} disabled={busy || candidate.status !== "pending"}>
          <XCircle size={15} />
          忽略
        </button>
        <button className="button" type="button" onClick={onConfirm} disabled={busy || candidate.status !== "pending"}>
          <CheckCircle size={15} />
          确认
        </button>
      </div>
    </article>
  );
}

function SourceBlock({
  title,
  excerpt,
  createdAt,
}: {
  title: string;
  excerpt: string;
  createdAt: string;
}) {
  return (
    <div className="memory-source-block">
      <span>{title || "未记录来源"}</span>
      {excerpt && <p>{excerpt}</p>}
      <time>{new Date(createdAt).toLocaleString()}</time>
    </div>
  );
}
