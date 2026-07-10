import {
  ArrowSquareOut,
  CheckCircle,
  DownloadSimple,
  FloppyDisk,
  MagicWand,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { CustomSelect, type CustomSelectOption } from "../../components/CustomSelect";
import { api } from "../../lib/api";
import type {
  LearningPlan,
  PlanTask,
  PlanTaskPriority,
  PlanTaskStatus,
  PlanTaskType,
  Source,
  Space,
} from "../../lib/types";

type PlanTaskView = "focus" | "all" | "done";
type PlanSideView = "generate" | "manual" | "task";

type TaskDraft = {
  title: string;
  description: string;
  task_type: PlanTaskType;
  status: PlanTaskStatus;
  priority: PlanTaskPriority;
  due_date: string;
  source_ids: string[];
  review_prompt: string;
  recommended_reason: string;
};

const taskTypeLabels: Record<PlanTaskType, string> = {
  study: "学习",
  review: "复习",
  practice: "练习",
  note: "笔记",
};

const statusLabels: Record<PlanTaskStatus, string> = {
  todo: "待做",
  in_progress: "进行中",
  done: "已完成",
  skipped: "已跳过",
};

const priorityLabels: Record<PlanTaskPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const taskTypeOptions: CustomSelectOption<PlanTaskType>[] = [
  { value: "study", label: "学习" },
  { value: "review", label: "复习" },
  { value: "practice", label: "练习" },
  { value: "note", label: "笔记" },
];

const statusOptions: CustomSelectOption<PlanTaskStatus>[] = [
  { value: "todo", label: "待做" },
  { value: "in_progress", label: "进行中" },
  { value: "done", label: "已完成" },
  { value: "skipped", label: "已跳过" },
];

const priorityOptions: CustomSelectOption<PlanTaskPriority>[] = [
  { value: "low", label: "低优先级" },
  { value: "medium", label: "中优先级" },
  { value: "high", label: "高优先级" },
];

export function PlansSection({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const [space, setSpace] = useState<Space | null>(null);
  const [plan, setPlan] = useState<LearningPlan | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [taskView, setTaskView] = useState<PlanTaskView>("focus");
  const [sideView, setSideView] = useState<PlanSideView>("generate");
  const [generateGoal, setGenerateGoal] = useState("");
  const [cadence, setCadence] = useState("每周 4 次，每次 45 分钟");
  const [targetLevel, setTargetLevel] = useState("能独立复述核心概念，并完成基础练习");
  const [deadline, setDeadline] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualGoal, setManualGoal] = useState("");
  const [newTaskDraft, setNewTaskDraft] = useState<TaskDraft>(() => emptyTaskDraft());
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(() => emptyTaskDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  const readySources = useMemo(
    () => sources.filter((source) => source.status === "ready" && source.enabled),
    [sources],
  );
  const visibleTasks = useMemo(() => {
    if (!plan) return [];
    if (taskView === "done") return plan.tasks.filter((task) => task.status === "done");
    if (taskView === "all") return plan.tasks;
    const active = plan.tasks.filter((task) => task.status !== "done" && task.status !== "skipped");
    return active.slice(0, 4);
  }, [plan, taskView]);

  const load = async () => {
    const [spaceRow, currentPlan, sourceRows] = await Promise.all([
      api.getSpace(spaceId),
      api.getCurrentPlan(spaceId),
      api.listSources(spaceId),
    ]);
    setSpace(spaceRow);
    setPlan(currentPlan);
    setSources(sourceRows);
    setGenerateGoal((current) => current || spaceRow.goal || "");
    setManualGoal((current) => current || spaceRow.goal || "");
  };

  useEffect(() => {
    load().catch((exc) => setError(exc instanceof Error ? exc.message : "计划加载失败"));
  }, [spaceId]);

  const runAction = async (action: () => Promise<LearningPlan | null | void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      if (next !== undefined) setPlan(next);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "计划操作失败");
    } finally {
      setBusy(false);
    }
  };

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    await runAction(async () => {
      const next = await api.generatePlan(spaceId, {
        goal: generateGoal.trim() || undefined,
        cadence,
        target_level: targetLevel,
        deadline: deadline || null,
      });
      setNotice("已基于关键假设生成新的当前计划。");
      return next;
    });
  };

  const createManualPlan = async (event: FormEvent) => {
    event.preventDefault();
    const goal = manualGoal.trim();
    if (!goal) return;
    await runAction(async () => {
      const next = await api.createPlan(spaceId, {
        title: manualTitle.trim() || undefined,
        goal,
        cadence,
        target_level: targetLevel,
        deadline: deadline || null,
        assumptions: {
          goal,
          cadence,
          target_level: targetLevel,
          deadline: deadline || null,
          mode: "manual",
        },
      });
      setManualTitle("");
      setNotice("已创建手动计划。");
      return next;
    });
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!plan || !newTaskDraft.title.trim()) return;
    await runAction(async () => {
      const next = await api.createPlanTask(spaceId, plan.id, taskPayload(newTaskDraft));
      setNewTaskDraft(emptyTaskDraft());
      setNotice("任务已加入当前计划。");
      return next;
    });
  };

  const startEdit = (task: PlanTask) => {
    setEditingTaskId(task.id);
    setTaskDraft({
      title: task.title,
      description: task.description,
      task_type: task.task_type,
      status: task.status,
      priority: task.priority,
      due_date: task.due_date ?? "",
      source_ids: task.source_ids,
      review_prompt: task.review_prompt,
      recommended_reason: task.recommended_reason,
    });
    setError(null);
    setNotice(null);
  };

  const saveTask = async (task: PlanTask) => {
    if (!plan || !taskDraft.title.trim()) return;
    await runAction(async () => {
      const next = await api.updatePlanTask(spaceId, plan.id, task.id, taskPayload(taskDraft));
      setEditingTaskId(null);
      setNotice("任务已更新。");
      return next;
    });
  };

  const completeTask = async (task: PlanTask) => {
    if (!plan) return;
    await runAction(async () => {
      const next = await api.completePlanTask(spaceId, plan.id, task.id, {
        review_result: task.task_type === "review" ? "已手动标记复习完成。" : "已手动标记完成。",
      });
      setNotice("任务已完成，空间进度已同步。");
      return next;
    });
  };

  const reopenTask = async (task: PlanTask) => {
    if (!plan) return;
    await runAction(async () => {
      const next = await api.updatePlanTask(spaceId, plan.id, task.id, {
        status: "todo",
      });
      setNotice("任务已重新打开。");
      return next;
    });
  };

  const removeTask = async (task: PlanTask) => {
    if (!plan) return;
    const confirmed = window.confirm(`删除任务“${task.title}”？`);
    if (!confirmed) return;
    await runAction(async () => {
      const next = await api.deletePlanTask(spaceId, plan.id, task.id);
      setNotice("任务已删除。");
      return next;
    });
  };

  const startReview = (task: PlanTask) => {
    if (!plan) return;
    const prompt = task.review_prompt || defaultReviewPrompt(plan, task);
    const params = new URLSearchParams({
      reviewPlanId: plan.id,
      reviewTaskId: task.id,
      reviewPrompt: prompt,
    });
    navigate(`/spaces/${spaceId}/learning?${params.toString()}`);
  };

  const exportMarkdown = async () => {
    if (!plan) return;
    await runAction(async () => {
      const result = await api.exportPlanMarkdown(spaceId, plan.id);
      const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFilename(result.title)}.md`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("当前计划已导出为 Markdown。");
    });
  };

  return (
    <div className="plans-layout">
      <section className="plans-main">
        <div className="plans-header">
          <div>
            <p className="eyebrow">Plan Loop</p>
            <h2>{plan ? plan.title : "学习计划"}</h2>
          </div>
          {plan && (
            <button className="button ghost" disabled={busy} onClick={exportMarkdown}>
              <DownloadSimple size={15} />
              导出 Markdown
            </button>
          )}
        </div>

        {error && <div className="notice danger">{error}</div>}
        {notice && <div className="notice success">{notice}</div>}

        {plan ? (
          <>
            <section className="plan-overview">
              <div>
                <span>完成率</span>
                <strong>{plan.summary.progress_percent}%</strong>
              </div>
              <div>
                <span>任务</span>
                <strong>
                  {plan.summary.done_tasks}/{plan.summary.total_tasks}
                </strong>
              </div>
              <div>
                <span>复习</span>
                <strong>
                  {plan.summary.review_done_tasks ?? 0}/{plan.summary.review_tasks ?? 0}
                </strong>
              </div>
              <div>
                <span>延期</span>
                <strong>{plan.summary.overdue_tasks}</strong>
              </div>
            </section>

            <section className="panel plan-context">
              <div>
                <p className="eyebrow">Goal</p>
                <p>{plan.goal}</p>
              </div>
              <div className="plan-context-grid">
                <span>{plan.cadence || "未设置节奏"}</span>
                <span>{plan.target_level || "未设置目标水平"}</span>
                <span>{plan.deadline ? `截止 ${plan.deadline}` : "未设置截止日期"}</span>
              </div>
              {plan.rationale && <p className="muted">{plan.rationale}</p>}
            </section>

            {plan.adjustment_suggestions.length > 0 && (
              <section className="plan-suggestions">
                {plan.adjustment_suggestions.map((suggestion) => (
                  <div key={suggestion}>{suggestion}</div>
                ))}
              </section>
            )}

            <div className="context-tabs plan-task-tabs" role="tablist" aria-label="计划任务视图">
              <button className={taskView === "focus" ? "active" : ""} onClick={() => setTaskView("focus")} type="button">
                当前执行
              </button>
              <button className={taskView === "all" ? "active" : ""} onClick={() => setTaskView("all")} type="button">
                全部任务
              </button>
              <button className={taskView === "done" ? "active" : ""} onClick={() => setTaskView("done")} type="button">
                已完成
              </button>
            </div>

            <div className="plan-task-list">
              {visibleTasks.map((task) => (
                <article className={`plan-task ${task.status}`} key={task.id}>
                  {editingTaskId === task.id ? (
                    <TaskEditor
                      draft={taskDraft}
                      onCancel={() => setEditingTaskId(null)}
                      onChange={setTaskDraft}
                      onSave={() => saveTask(task)}
                      readySources={readySources}
                      busy={busy}
                    />
                  ) : (
                    <>
                      <div className="plan-task-head">
                        <div>
                          <div className="plan-task-meta">
                            <span>{taskTypeLabels[task.task_type]}</span>
                            <span>{priorityLabels[task.priority]}优先级</span>
                            <span>{statusLabels[task.status]}</span>
                            {task.due_date && <span>截止 {task.due_date}</span>}
                          </div>
                          <h3>{task.title}</h3>
                        </div>
                        <div className="plan-task-actions">
                          <button className="button ghost" disabled={busy} onClick={() => startEdit(task)}>
                            <PencilSimple size={15} />
                            编辑
                          </button>
                          {task.status === "done" ? (
                            <button className="button ghost" disabled={busy} onClick={() => reopenTask(task)}>
                              <X size={15} />
                              重开
                            </button>
                          ) : (
                            <button className="button ghost" disabled={busy} onClick={() => completeTask(task)}>
                              <CheckCircle size={15} />
                              完成
                            </button>
                          )}
                          {task.task_type === "review" && (
                            <button className="button" disabled={busy} onClick={() => startReview(task)}>
                              <ArrowSquareOut size={15} />
                              复习问答
                            </button>
                          )}
                          <button className="button ghost danger-text" disabled={busy} onClick={() => removeTask(task)}>
                            <Trash size={15} />
                          </button>
                        </div>
                      </div>
                      {task.description && <p>{task.description}</p>}
                      {task.recommended_reason && (
                        <div className="plan-reason">推荐原因：{task.recommended_reason}</div>
                      )}
                      {task.source_ids.length > 0 && (
                        <div className="plan-linked-sources">
                          {task.source_ids.map((sourceId) => (
                            <span key={sourceId}>{sourceById.get(sourceId)?.title ?? "已关联资料"}</span>
                          ))}
                        </div>
                      )}
                      {task.review_result && (
                        <div className="plan-review-result">复习结果：{task.review_result}</div>
                      )}
                    </>
                  )}
                </article>
              ))}
              {visibleTasks.length === 0 && (
                <div className="empty plan-task-empty">
                  <h3>{taskView === "done" ? "还没有完成记录" : "当前没有待执行任务"}</h3>
                  <p>{taskView === "done" ? "完成任务或复习问答后会在这里沉淀记录。" : "可以切到添加任务，或者重新生成一轮计划。"}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty large">
            <h2>还没有当前计划</h2>
            <p>可以先基于目标生成计划，也可以手动创建一个最小计划。</p>
          </div>
        )}
      </section>

      <aside className="plans-side">
        <section className="panel plan-side-switcher">
          <p className="eyebrow">Plan Tools</p>
          <h3>计划工具</h3>
          <div className="context-tabs" role="tablist" aria-label="计划工具视图">
            <button className={sideView === "generate" ? "active" : ""} onClick={() => setSideView("generate")} type="button">
              生成
            </button>
            <button className={sideView === "manual" ? "active" : ""} onClick={() => setSideView("manual")} type="button">
              手动
            </button>
            <button
              className={sideView === "task" ? "active" : ""}
              onClick={() => setSideView("task")}
              type="button"
              disabled={!plan}
            >
              任务
            </button>
          </div>
        </section>

        {sideView === "generate" && (
          <section className="panel">
            <div className="section-header compact">
              <div>
                <p className="eyebrow">Assumptions</p>
                <h3>关键假设</h3>
              </div>
            </div>
            <form className="plan-form" onSubmit={generate}>
              <label>
                学习目标
                <textarea value={generateGoal} onChange={(event) => setGenerateGoal(event.target.value)} rows={4} />
              </label>
              <label>
                学习节奏
                <input value={cadence} onChange={(event) => setCadence(event.target.value)} />
              </label>
              <label>
                目标水平
                <input value={targetLevel} onChange={(event) => setTargetLevel(event.target.value)} />
              </label>
              <label>
                截止日期
                <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </label>
              <div className="plan-source-summary">
                <span>{readySources.length} 个可用于生成计划的已就绪资料</span>
                <span>{space?.counts.notes ?? 0} 条笔记</span>
              </div>
              <button className="button" disabled={busy || !generateGoal.trim()}>
                <MagicWand size={15} />
                AI 生成计划
              </button>
            </form>
          </section>
        )}

        {sideView === "manual" && (
          <section className="panel">
            <p className="eyebrow">Manual Plan</p>
            <h3>手动创建计划</h3>
            <form className="plan-form" onSubmit={createManualPlan}>
              <label>
                计划标题
                <input
                  value={manualTitle}
                  onChange={(event) => setManualTitle(event.target.value)}
                  placeholder="可留空自动生成"
                />
              </label>
              <label>
                计划目标
                <textarea value={manualGoal} onChange={(event) => setManualGoal(event.target.value)} rows={3} />
              </label>
              <button className="button secondary" disabled={busy || !manualGoal.trim()}>
                <Plus size={15} />
                创建计划
              </button>
            </form>
          </section>
        )}

        {sideView === "task" && plan && (
          <section className="panel">
            <p className="eyebrow">Task</p>
            <h3>添加任务</h3>
            <form className="plan-form" onSubmit={createTask}>
              <TaskFields draft={newTaskDraft} onChange={setNewTaskDraft} readySources={readySources} compact />
              <button className="button secondary" disabled={busy || !newTaskDraft.title.trim()}>
                <Plus size={15} />
                添加任务
              </button>
            </form>
          </section>
        )}
      </aside>
    </div>
  );
}

function TaskEditor({
  draft,
  onCancel,
  onChange,
  onSave,
  readySources,
  busy,
}: {
  draft: TaskDraft;
  onCancel: () => void;
  onChange: (draft: TaskDraft) => void;
  onSave: () => void;
  readySources: Source[];
  busy: boolean;
}) {
  return (
    <div className="plan-task-editor">
      <TaskFields draft={draft} onChange={onChange} readySources={readySources} />
      <div className="plan-task-actions">
        <button className="button" disabled={busy || !draft.title.trim()} onClick={onSave}>
          <FloppyDisk size={15} />
          保存
        </button>
        <button className="button ghost" disabled={busy} onClick={onCancel}>
          <X size={15} />
          取消
        </button>
      </div>
    </div>
  );
}

function TaskFields({
  draft,
  onChange,
  readySources,
  compact = false,
}: {
  draft: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  readySources: Source[];
  compact?: boolean;
}) {
  const patch = (next: Partial<TaskDraft>) => onChange({ ...draft, ...next });
  const toggleSource = (sourceId: string) => {
    patch({
      source_ids: draft.source_ids.includes(sourceId)
        ? draft.source_ids.filter((id) => id !== sourceId)
        : [...draft.source_ids, sourceId],
    });
  };
  return (
    <div className={`plan-task-fields ${compact ? "compact" : ""}`}>
      <label>
        任务名称
        <input value={draft.title} onChange={(event) => patch({ title: event.target.value })} />
      </label>
      <label>
        说明
        <textarea
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
          rows={compact ? 2 : 3}
        />
      </label>
      <div className="plan-field-grid">
        <label>
          类型
          <CustomSelect value={draft.task_type} options={taskTypeOptions} onChange={(task_type) => patch({ task_type })} />
        </label>
        <label>
          状态
          <CustomSelect value={draft.status} options={statusOptions} onChange={(status) => patch({ status })} />
        </label>
        <label>
          优先级
          <CustomSelect value={draft.priority} options={priorityOptions} onChange={(priority) => patch({ priority })} />
        </label>
        <label>
          截止日期
          <input type="date" value={draft.due_date} onChange={(event) => patch({ due_date: event.target.value })} />
        </label>
      </div>
      {draft.task_type === "review" && (
        <label>
          复习问答提示
          <textarea value={draft.review_prompt} onChange={(event) => patch({ review_prompt: event.target.value })} rows={3} />
        </label>
      )}
      <label>
        推荐原因
        <textarea
          value={draft.recommended_reason}
          onChange={(event) => patch({ recommended_reason: event.target.value })}
          rows={2}
        />
      </label>
      {readySources.length > 0 && (
        <div className="plan-source-picker">
          {readySources.map((source) => (
            <label className="source-check" key={source.id}>
              <input
                type="checkbox"
                checked={draft.source_ids.includes(source.id)}
                onChange={() => toggleSource(source.id)}
              />
              <span>
                <strong>{source.title}</strong>
                <small>{source.chunk_count ?? 0} 个片段</small>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function emptyTaskDraft(): TaskDraft {
  return {
    title: "",
    description: "",
    task_type: "study",
    status: "todo",
    priority: "medium",
    due_date: "",
    source_ids: [],
    review_prompt: "",
    recommended_reason: "",
  };
}

function taskPayload(draft: TaskDraft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    task_type: draft.task_type,
    status: draft.status,
    priority: draft.priority,
    due_date: draft.due_date || null,
    source_ids: draft.source_ids,
    review_prompt: draft.review_prompt.trim(),
    recommended_reason: draft.recommended_reason.trim(),
  };
}

function defaultReviewPrompt(plan: LearningPlan, task: PlanTask) {
  return `请围绕当前学习计划“${plan.title}”中的任务“${task.title}”进行复习问答。先问我 3 个诊断问题，再根据我的回答指出薄弱点和下一步建议。`;
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "learning-plan";
}
