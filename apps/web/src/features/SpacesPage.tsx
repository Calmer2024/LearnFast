import { Archive, ArrowRight, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppDialog } from "../components/AppDialog";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { Health, Space } from "../lib/types";

export function SpacesPage() {
  const navigate = useNavigate();
  const dialog = useAppDialog();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [name, setName] = useState("");
  const [readme, setReadme] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setError(null);
    const [spaceRows, healthStatus] = await Promise.all([
      api.listSpaces(showArchived),
      api.health(),
    ]);
    setSpaces(spaceRows);
    setHealth(healthStatus);
  };

  useEffect(() => {
    load().catch((exc) => setError(exc.message));
  }, [showArchived]);

  const createSpace = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const space = await api.createSpace({ name, goal: readme });
      setName("");
      setReadme("");
      setCreateOpen(false);
      navigate(`/spaces/${space.id}/learning`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "创建失败");
    } finally {
      setLoading(false);
    }
  };

  const openEditSpace = (space: Space) => {
    setEditingSpace(space);
    setName(space.name);
    setReadme(space.goal);
    setError(null);
  };

  const closeSpaceModal = () => {
    setCreateOpen(false);
    setEditingSpace(null);
    setName("");
    setReadme("");
  };

  const saveSpace = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingSpace || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.updateSpace(editingSpace.id, { name, goal: readme });
      closeSpaceModal();
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const archiveSpace = async (space: Space) => {
    await api.updateSpace(space.id, {
      status: space.status === "archived" ? "active" : "archived",
    });
    await load();
  };

  const deleteSpace = async (space: Space) => {
    const confirmed = await dialog.confirm({
      title: `删除学习空间“${space.name}”？`,
      body: "该操作会删除空间内资料记录。",
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!confirmed) return;
    await api.deleteSpace(space.id);
    await load();
  };

  return (
    <main className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">本地单用户 MVP</p>
          <h1>学习空间</h1>
        </div>
        <button className="button" type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={15} />
          创建学习空间
        </button>
      </section>

      {error && <div className="notice danger">{error}</div>}

      <section className="toolbar">
        <div className="muted">
          {health ? `数据目录：${health.data_dir}` : "正在读取本地状态"}
        </div>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          显示归档
        </label>
      </section>

      <section className="space-grid">
        {spaces.map((space) => (
          <article
            aria-label={`进入学习空间：${space.name}`}
            className="space-card"
            key={space.id}
            onClick={() => navigate(`/spaces/${space.id}/learning`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigate(`/spaces/${space.id}/learning`);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="card-header">
              <h2>{space.name}</h2>
              <StatusBadge status={space.status} />
            </div>
            <div className="space-readme-preview">
              <span>README</span>
              <p>{space.goal || "还没有填写 README。"}</p>
            </div>
            <dl className="source-card-meta space-card-meta">
              <div>
                <dt>资料</dt>
                <dd>{space.counts.sources}</dd>
              </div>
              <div>
                <dt>笔记</dt>
                <dd>{space.counts.notes}</dd>
              </div>
              <div>
                <dt>计划</dt>
                <dd>
                  {space.counts.plan.total_tasks > 0
                    ? `${space.counts.plan.progress_percent}%`
                    : "未创建"}
                </dd>
              </div>
              <div>
                <dt>更新</dt>
                <dd>{new Date(space.updated_at).toLocaleString()}</dd>
              </div>
            </dl>
            <div
              className="card-actions"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <button className="button" onClick={() => navigate(`/spaces/${space.id}/learning`)}>
                <ArrowRight size={15} />
                进入
              </button>
              <button className="button secondary" onClick={() => openEditSpace(space)}>
                <PencilSimple size={15} />
                编辑
              </button>
              <button className="button secondary" onClick={() => archiveSpace(space)}>
                <Archive size={15} />
                {space.status === "archived" ? "恢复" : "归档"}
              </button>
              <button className="button ghost danger-text" onClick={() => deleteSpace(space)}>
                <Trash size={15} />
                删除
              </button>
            </div>
          </article>
        ))}
        {spaces.length === 0 && (
          <div className="empty">
            <h2>还没有小书架</h2>
            <p>创建第一个学习空间，把资料、笔记和计划都温柔地收进去。</p>
          </div>
        )}
      </section>

      {createOpen && (
        <div className="modal-backdrop" onClick={closeSpaceModal}>
          <section
            aria-modal="true"
            className="source-import-modal space-create-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="source-import-modal-head">
              <div>
                <p className="eyebrow">Create Space</p>
                <h3>创建学习空间</h3>
              </div>
              <button className="button ghost" type="button" onClick={closeSpaceModal}>
                <X size={15} />
                关闭
              </button>
            </div>
            <form className="modal-form" onSubmit={createSpace}>
              <label>
                空间名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：Python 数据分析学习"
                />
              </label>
              <label>
                README
                <textarea
                  value={readme}
                  onChange={(event) => setReadme(event.target.value)}
                  placeholder="描述这个知识库沉淀什么知识、服务什么场景、适合怎样使用"
                  rows={4}
                />
              </label>
              <div className="card-actions">
                <button className="button" disabled={loading || !name.trim()}>
                  <Plus size={15} />
                  {loading ? "创建中..." : "创建学习空间"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {editingSpace && (
        <div className="modal-backdrop" onClick={closeSpaceModal}>
          <section
            aria-modal="true"
            className="source-import-modal space-create-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="source-import-modal-head">
              <div>
                <p className="eyebrow">Edit Space</p>
                <h3>编辑学习空间</h3>
              </div>
              <button className="button ghost" type="button" onClick={closeSpaceModal}>
                <X size={15} />
                关闭
              </button>
            </div>
            <form className="modal-form" onSubmit={saveSpace}>
              <label>
                空间名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：Python 数据分析学习"
                />
              </label>
              <label>
                README
                <textarea
                  value={readme}
                  onChange={(event) => setReadme(event.target.value)}
                  placeholder="描述这个知识库沉淀什么知识、服务什么场景、适合怎样使用"
                  rows={5}
                />
              </label>
              <div className="card-actions">
                <button className="button" disabled={loading || !name.trim()}>
                  <PencilSimple size={15} />
                  {loading ? "保存中..." : "保存修改"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {dialog.node}
    </main>
  );
}
