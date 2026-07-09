import { Archive, ArrowRight, Plus, Trash } from "@phosphor-icons/react";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { Health, Space } from "../lib/types";

export function SpacesPage() {
  const navigate = useNavigate();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
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
      const space = await api.createSpace({ name, goal });
      setName("");
      setGoal("");
      navigate(`/spaces/${space.id}/learning`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "创建失败");
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
    const confirmed = window.confirm(`删除学习空间“${space.name}”？该操作会删除空间内资料记录。`);
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
      </section>

      {error && <div className="notice danger">{error}</div>}

      <section className="panel">
        <form className="create-form" onSubmit={createSpace}>
          <label>
            空间名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：Python 数据分析学习"
            />
          </label>
          <label>
            学习目标
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="写下这个空间要解决的学习目标"
              rows={3}
            />
          </label>
          <button className="button" disabled={loading || !name.trim()}>
            <Plus size={15} />
            {loading ? "创建中..." : "创建学习空间"}
          </button>
        </form>
      </section>

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
          <article className="space-card" key={space.id}>
            <div className="card-header">
              <h2>{space.name}</h2>
              <StatusBadge status={space.status} />
            </div>
            <p>{space.goal || "还没有填写学习目标。"}</p>
            <dl className="meta-grid">
              <div>
                <dt>资料</dt>
                <dd>{space.counts.sources}</dd>
              </div>
              <div>
                <dt>更新</dt>
                <dd>{new Date(space.updated_at).toLocaleString()}</dd>
              </div>
            </dl>
            <div className="card-actions">
              <button className="button" onClick={() => navigate(`/spaces/${space.id}/learning`)}>
                <ArrowRight size={15} />
                进入
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
            <h2>还没有学习空间</h2>
            <p>先创建一个主题空间，再上传资料或导入网页开始学习。</p>
          </div>
        )}
      </section>
    </main>
  );
}
