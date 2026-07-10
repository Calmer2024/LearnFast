import {
  ArrowSquareOut,
  CalendarBlank,
  CaretLeft,
  CaretRight,
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

import { useAppDialog } from "../../components/AppDialog";
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

type PlanTaskView = "today" | "upcoming" | "all" | "done";
type TaskTypeFilter = "all" | PlanTaskType;
type PriorityFilter = "all" | PlanTaskPriority;
type DateFilter = "all" | "today" | "upcoming" | "unscheduled" | "overdue";

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

const taskTypeFilterOptions: CustomSelectOption<TaskTypeFilter>[] = [
  { value: "all", label: "全部类型" },
  ...taskTypeOptions,
];

const priorityFilterOptions: CustomSelectOption<PriorityFilter>[] = [
  { value: "all", label: "全部优先级" },
  ...priorityOptions,
];

const dateFilterOptions: CustomSelectOption<DateFilter>[] = [
  { value: "all", label: "全部日期" },
  { value: "today", label: "今天" },
  { value: "upcoming", label: "未来" },
  { value: "unscheduled", label: "未排期" },
  { value: "overdue", label: "已延期" },
];

export function PlansSection({ spaceId }: { spaceId: string }) {
  const navigate = useNavigate();
  const dialog = useAppDialog();
  const [space, setSpace] = useState<Space | null>(null);
  const [plan, setPlan] = useState<LearningPlan | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [taskView, setTaskView] = useState<PlanTaskView>("today");
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [generateGoal, setGenerateGoal] = useState("");
  const [cadence, setCadence] = useState("每周 4 次，每次 45 分钟");
  const [targetLevel, setTargetLevel] = useState("能独立复述核心概念，并完成基础练习");
  const [deadline, setDeadline] = useState("");
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
  const todayIso = useMemo(() => localDateISO(), []);
  const taskGroups = useMemo(() => groupPlanTasks(plan?.tasks ?? [], todayIso), [plan?.tasks, todayIso]);
  const visibleTodoTasks = useMemo(
    () => filterTodoTasks(getTodoTasks(taskView, taskGroups), { dateFilter, priorityFilter, taskTypeFilter }, todayIso),
    [dateFilter, priorityFilter, taskGroups, taskTypeFilter, taskView, todayIso],
  );
  const taskViewMeta = getTaskViewMeta(taskView, taskGroups);
  const planTitle = plan?.title || planTitleForCreate(space);
  const planGoal = plan?.goal || space?.goal || "添加第一条待办后，LearnFast 会自动创建当前计划。";
  const calendarDays = useMemo(
    () => buildCalendarDays(calendarMonth, plan?.tasks ?? [], todayIso),
    [calendarMonth, plan?.tasks, todayIso],
  );
  const calendarMonthLabel = useMemo(
    () => new Intl.DateTimeFormat("zh-CN", { month: "long", year: "numeric" }).format(calendarMonth),
    [calendarMonth],
  );

  const syncPlanFields = (next: LearningPlan) => {
    setCadence(next.cadence || "每周 4 次，每次 45 分钟");
    setTargetLevel(next.target_level || "能独立复述核心概念，并完成基础练习");
    setDeadline(next.deadline ?? "");
    setGenerateGoal(next.goal);
  };

  const load = async () => {
    const [spaceRow, currentPlan, sourceRows] = await Promise.all([
      api.getSpace(spaceId),
      api.getCurrentPlan(spaceId),
      api.listSources(spaceId),
    ]);
    setSpace(spaceRow);
    setPlan(currentPlan);
    setSources(sourceRows);
    if (currentPlan) {
      syncPlanFields(currentPlan);
    } else {
      setGenerateGoal((current) => current || spaceRow.goal || "");
    }
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
      setAiPanelOpen(false);
      setTaskView("today");
      syncPlanFields(next);
      setNotice("AI 已完成规划，并把待办加入当前列表。");
      return next;
    });
  };

  const createPlanFromTask = async (draft: TaskDraft) => {
    const goal = planGoalForCreate(space, generateGoal);
    const task = taskPayload(draft);
    const next = await api.createPlan(spaceId, {
      title: planTitleForCreate(space),
      goal,
      cadence,
      target_level: targetLevel,
      deadline: deadline || null,
      assumptions: {
        goal,
        cadence,
        target_level: targetLevel,
        deadline: deadline || null,
        mode: "manual-first-todo",
      },
      tasks: [task],
    });
    syncPlanFields(next);
    return next;
  };

  const prepareQuickAdd = () => {
    setNewTaskDraft({
      ...emptyTaskDraft(),
      due_date: taskView === "today" ? todayIso : "",
    });
    setQuickAddOpen(true);
  };

  const cancelQuickAdd = () => {
    setNewTaskDraft(emptyTaskDraft());
    setQuickAddOpen(false);
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!newTaskDraft.title.trim()) return;
    await runAction(async () => {
      const next = plan
        ? await api.createPlanTask(spaceId, plan.id, taskPayload(newTaskDraft))
        : await createPlanFromTask(newTaskDraft);
      setNewTaskDraft(emptyTaskDraft());
      setQuickAddOpen(false);
      if (taskView === "done") setTaskView("all");
      setNotice(plan ? "任务已加入当前计划。" : "已创建当前计划，并添加第一条待办。");
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
    const confirmed = await dialog.confirm({
      title: `删除任务“${task.title}”？`,
      body: "删除后当前计划中将不再显示这项任务。",
      confirmLabel: "删除",
      variant: "danger",
    });
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

  const shiftCalendarMonth = (offset: number) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <div className="todo-planner-layout">
      <section className="todo-planner-main">
        <header className="todo-topbar">
          <div className="todo-title-block">
            <p className="eyebrow">ToDo List</p>
            <h2>{planTitle}</h2>
            <p>{planGoal}</p>
          </div>
          <div className="todo-topbar-actions">
            <button
              className={`button ai-core-button ${aiPanelOpen ? "active" : ""}`.trim()}
              onClick={() => {
                setGenerateGoal((current) => current || space?.goal || "");
                setAiPanelOpen(true);
              }}
              type="button"
            >
              <MagicWand size={15} />
              AI 帮我规划
            </button>
            {plan && (
              <button className="button ghost" disabled={busy} onClick={exportMarkdown} type="button">
                <DownloadSimple size={15} />
                导出
              </button>
            )}
          </div>
        </header>

        {error && <div className="notice danger">{error}</div>}
        {notice && <div className="notice success">{notice}</div>}

        <section className="todo-list-panel">
          <div className="todo-view-tabs" role="tablist" aria-label="待办视图">
            {[
              { id: "today" as const, label: "今天", count: taskGroups.today.length },
              { id: "upcoming" as const, label: "接下来", count: taskGroups.upcoming.length + taskGroups.backlog.length },
              { id: "all" as const, label: "全部", count: taskGroups.active.length },
              { id: "done" as const, label: "已完成", count: taskGroups.done.length },
            ].map((item) => (
              <button
                className={taskView === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setTaskView(item.id)}
                type="button"
              >
                {item.label}
                <span>{item.count}</span>
              </button>
            ))}
          </div>

          <div className="todo-list-filters">
            <CustomSelect value={taskTypeFilter} options={taskTypeFilterOptions} onChange={setTaskTypeFilter} />
            <CustomSelect value={priorityFilter} options={priorityFilterOptions} onChange={setPriorityFilter} />
            <CustomSelect value={dateFilter} options={dateFilterOptions} onChange={setDateFilter} />
            <span>{visibleTodoTasks.length} 项</span>
          </div>

          <div className="todo-task-list">
            {quickAddOpen ? (
              <form className="todo-inline-add" onSubmit={createTask}>
                <input
                  autoFocus
                  value={newTaskDraft.title}
                  onChange={(event) => setNewTaskDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="写下新的待办"
                />
                <CustomSelect
                  value={newTaskDraft.task_type}
                  options={taskTypeOptions}
                  onChange={(task_type) => setNewTaskDraft((current) => ({ ...current, task_type }))}
                />
                <CustomSelect
                  value={newTaskDraft.priority}
                  options={priorityOptions}
                  onChange={(priority) => setNewTaskDraft((current) => ({ ...current, priority }))}
                />
                <label className="todo-date-input">
                  <CalendarBlank size={15} />
                  <input
                    aria-label="截止日期"
                    type="date"
                    value={newTaskDraft.due_date}
                    onChange={(event) => setNewTaskDraft((current) => ({ ...current, due_date: event.target.value }))}
                  />
                </label>
                <button className="button" disabled={busy || !newTaskDraft.title.trim()} type="submit">
                  <Plus size={15} />
                  添加
                </button>
                <button className="button ghost" disabled={busy} onClick={cancelQuickAdd} type="button">
                  取消
                </button>
              </form>
            ) : (
              <button className="todo-inline-add-trigger" onClick={prepareQuickAdd} type="button">
                <Plus size={16} />
                添加待办
              </button>
            )}

            {visibleTodoTasks.map((task) => (
              <article className={`plan-task ${task.status} priority-${task.priority}`} key={task.id}>
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
                  <TaskCard
                    busy={busy}
                    onComplete={completeTask}
                    onEdit={startEdit}
                    onRemove={removeTask}
                    onReopen={reopenTask}
                    onReview={startReview}
                    sourceById={sourceById}
                    task={task}
                    todayIso={todayIso}
                  />
                )}
              </article>
            ))}
            {visibleTodoTasks.length === 0 && (
              <div className="empty todo-empty-state">
                <h3>{taskViewMeta.emptyTitle}</h3>
                <p>{taskViewMeta.emptyText}</p>
              </div>
            )}
          </div>
        </section>
      </section>

      <aside className="todo-planner-side">
        <section className="panel todo-calendar-panel">
          <div className="todo-calendar-head">
            <div>
              <p className="eyebrow">Calendar</p>
              <h3>{calendarMonthLabel}</h3>
            </div>
            <div className="todo-calendar-actions">
              <button aria-label="上个月" className="icon-button" onClick={() => shiftCalendarMonth(-1)} type="button">
                <CaretLeft size={15} />
              </button>
              <button aria-label="下个月" className="icon-button" onClick={() => shiftCalendarMonth(1)} type="button">
                <CaretRight size={15} />
              </button>
            </div>
          </div>
          <div className="todo-calendar-weekdays">
            {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="todo-calendar-grid">
            {calendarDays.map((day) => (
              <div
                className={`todo-calendar-day ${day.muted ? "muted" : ""} ${day.isToday ? "today" : ""} ${
                  day.totalCount > 0 ? "has-task" : ""
                }`.trim()}
                key={day.date}
              >
                <span>{day.label}</span>
                {day.totalCount > 0 && (
                  <small>
                    {day.doneCount}/{day.totalCount}
                  </small>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="todo-progress-card">
          <span>完成率</span>
          <strong>{plan?.summary.progress_percent ?? 0}%</strong>
          <div className="todo-progress-track">
            <div style={{ width: `${plan?.summary.progress_percent ?? 0}%` }} />
          </div>
          <small>
            {plan?.summary.done_tasks ?? 0}/{plan?.summary.total_tasks ?? 0} 个任务完成
          </small>
        </section>

        {plan && plan.adjustment_suggestions.length > 0 && (
          <section className="todo-suggestion-list">
            {plan.adjustment_suggestions.map((suggestion) => (
              <p key={suggestion}>{suggestion}</p>
            ))}
          </section>
        )}
      </aside>
      {aiPanelOpen && (
        <div className="modal-backdrop ai-plan-modal-backdrop" onMouseDown={() => setAiPanelOpen(false)}>
          <section
            aria-modal="true"
            className="ai-plan-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="ai-plan-modal-head">
              <div>
                <p className="eyebrow">AI Planner</p>
                <h3>AI 帮我规划</h3>
                <p>配置目标后，AI 会自动生成当前计划并添加待办。</p>
              </div>
              <button aria-label="关闭" className="icon-button" onClick={() => setAiPanelOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>
            <form className="ai-plan-modal-form" onSubmit={generate}>
              <label>
                学习目标
                <textarea value={generateGoal} onChange={(event) => setGenerateGoal(event.target.value)} rows={4} />
              </label>
              <div className="plan-source-summary">
                <span>{readySources.length} 个可用于生成计划的已就绪资料</span>
                <span>{space?.counts.notes ?? 0} 条笔记</span>
              </div>
              <div className="ai-plan-modal-actions">
                <button className="button ghost" onClick={() => setAiPanelOpen(false)} type="button">
                  取消
                </button>
                <button className="button" disabled={busy || !generateGoal.trim()} type="submit">
                  <MagicWand size={15} />
                  自动规划到待办
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {dialog.node}
    </div>
  );
}

type TaskGroups = {
  active: PlanTask[];
  backlog: PlanTask[];
  done: PlanTask[];
  today: PlanTask[];
  upcoming: PlanTask[];
};

type TaskViewMeta = {
  emptyText: string;
  emptyTitle: string;
  hint: string;
  title: string;
};

type CalendarDayView = {
  date: string;
  doneCount: number;
  isToday: boolean;
  label: number;
  muted: boolean;
  totalCount: number;
};

function getTodoTasks(view: PlanTaskView, groups: TaskGroups) {
  if (view === "today") return groups.today;
  if (view === "upcoming") return [...groups.upcoming, ...groups.backlog];
  if (view === "done") return groups.done;
  return groups.active;
}

function filterTodoTasks(
  tasks: PlanTask[],
  filters: {
    dateFilter: DateFilter;
    priorityFilter: PriorityFilter;
    taskTypeFilter: TaskTypeFilter;
  },
  todayIso: string,
) {
  return tasks.filter((task) => {
    if (filters.taskTypeFilter !== "all" && task.task_type !== filters.taskTypeFilter) return false;
    if (filters.priorityFilter !== "all" && task.priority !== filters.priorityFilter) return false;
    if (filters.dateFilter === "all") return true;
    const dueState = taskDueState(task, todayIso);
    if (filters.dateFilter === "unscheduled") return dueState === "none";
    return dueState === filters.dateFilter;
  });
}

function getTaskViewMeta(view: PlanTaskView, groups: TaskGroups): TaskViewMeta {
  if (view === "today") {
    return {
      title: "今天",
      hint: "只保留今天真正要推进的学习任务。",
      emptyTitle: "今天很干净",
      emptyText: groups.active.length > 0 ? "从接下来或全部任务里挑一项安排到今天。" : "添加第一条待办，开始一个小步推进。",
    };
  }
  if (view === "upcoming") {
    return {
      title: "接下来",
      hint: "有截止日期的后续任务，以及尚未安排日期的想法。",
      emptyTitle: "没有后续安排",
      emptyText: "给任务设置截止日期后，它会出现在这里。",
    };
  }
  if (view === "done") {
    return {
      title: "已完成",
      hint: "复盘已经完成的学习任务和复习结果。",
      emptyTitle: "还没有完成记录",
      emptyText: "完成任务后，这里会形成你的学习推进轨迹。",
    };
  }
  return {
    title: "全部待办",
    hint: "所有未完成任务，按状态、日期和优先级排序。",
    emptyTitle: "还没有待办",
    emptyText: "从上方快速添加一项，或者让 AI 帮你拆解学习目标。",
  };
}

function buildCalendarDays(monthDate: Date, tasks: PlanTask[], todayIso: string): CalendarDayView[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const tasksByDate = new Map<string, PlanTask[]>();

  tasks.forEach((task) => {
    if (!task.due_date) return;
    const current = tasksByDate.get(task.due_date) ?? [];
    current.push(task);
    tasksByDate.set(task.due_date, current);
  });

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const iso = dateToLocalISO(date);
    const dayTasks = tasksByDate.get(iso) ?? [];
    return {
      date: iso,
      doneCount: dayTasks.filter((task) => task.status === "done").length,
      isToday: iso === todayIso,
      label: date.getDate(),
      muted: date.getMonth() !== month,
      totalCount: dayTasks.length,
    };
  });
}

function TaskCard({
  busy,
  onComplete,
  onEdit,
  onRemove,
  onReopen,
  onReview,
  sourceById,
  task,
  todayIso,
}: {
  busy: boolean;
  onComplete: (task: PlanTask) => void;
  onEdit: (task: PlanTask) => void;
  onRemove: (task: PlanTask) => void;
  onReopen: (task: PlanTask) => void;
  onReview: (task: PlanTask) => void;
  sourceById: Map<string, Source>;
  task: PlanTask;
  todayIso: string;
}) {
  const done = task.status === "done";
  const dueState = taskDueState(task, todayIso);
  return (
    <>
      <button
        aria-label={done ? "重新打开任务" : "完成任务"}
        className={`task-check ${done ? "checked" : ""}`.trim()}
        disabled={busy}
        onClick={() => (done ? onReopen(task) : onComplete(task))}
        type="button"
      >
        <CheckCircle size={18} weight={done ? "fill" : "regular"} />
      </button>
      <div className="plan-task-content">
        <div className="plan-task-title-row">
          <h3>{task.title}</h3>
        </div>
        <div className="plan-task-meta">
          <span>{taskTypeLabels[task.task_type]}</span>
          <span>{statusLabels[task.status]}</span>
          <span className={`due-${dueState}`}>{formatDueLabel(task, todayIso)}</span>
        </div>
        {task.description && <p>{task.description}</p>}
        {task.recommended_reason && <div className="plan-reason">{task.recommended_reason}</div>}
        {task.source_ids.length > 0 && (
          <div className="plan-linked-sources">
            {task.source_ids.map((sourceId) => (
              <span key={sourceId}>{sourceById.get(sourceId)?.title ?? "已关联资料"}</span>
            ))}
          </div>
        )}
        {task.review_result && <div className="plan-review-result">{task.review_result}</div>}
      </div>
      <div className="plan-task-actions">
        <span className={`plan-priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
        <button aria-label="编辑任务" className="plan-icon-action" disabled={busy} onClick={() => onEdit(task)} type="button">
          <PencilSimple size={15} />
        </button>
        {task.task_type === "review" && (
          <button className="button ghost" disabled={busy} onClick={() => onReview(task)} type="button">
            <ArrowSquareOut size={15} />
            复习
          </button>
        )}
        <button aria-label="删除任务" className="plan-icon-action danger-text" disabled={busy} onClick={() => onRemove(task)} type="button">
          <Trash size={15} />
        </button>
      </div>
    </>
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

function groupPlanTasks(tasks: PlanTask[], todayIso: string): TaskGroups {
  const open = tasks.filter((task) => task.status !== "done" && task.status !== "skipped");
  const today = sortPlanTasks(
    open.filter((task) => task.status === "in_progress" || ["overdue", "today"].includes(taskDueState(task, todayIso))),
    todayIso,
  );
  const todayIds = new Set(today.map((task) => task.id));
  const upcoming = sortPlanTasks(
    open.filter((task) => !todayIds.has(task.id) && taskDueState(task, todayIso) === "upcoming"),
    todayIso,
  );
  const upcomingIds = new Set(upcoming.map((task) => task.id));
  const backlog = sortPlanTasks(
    open.filter((task) => !todayIds.has(task.id) && !upcomingIds.has(task.id)),
    todayIso,
  );
  const done = [...tasks]
    .filter((task) => task.status === "done")
    .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at));

  return {
    active: sortPlanTasks(open, todayIso),
    backlog,
    done,
    today,
    upcoming,
  };
}

function sortPlanTasks(tasks: PlanTask[], todayIso: string) {
  return [...tasks].sort((a, b) => {
    const statusRank = statusWeight(a.status) - statusWeight(b.status);
    if (statusRank !== 0) return statusRank;
    const dueRank = dueWeight(a, todayIso) - dueWeight(b, todayIso);
    if (dueRank !== 0) return dueRank;
    const priorityRank = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (priorityRank !== 0) return priorityRank;
    return a.order_index - b.order_index;
  });
}

function priorityWeight(priority: PlanTaskPriority) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusWeight(status: PlanTaskStatus) {
  if (status === "in_progress") return 0;
  if (status === "todo") return 1;
  if (status === "done") return 2;
  return 3;
}

function dueWeight(task: PlanTask, todayIso: string) {
  const state = taskDueState(task, todayIso);
  if (state === "overdue") return 0;
  if (state === "today") return 1;
  if (state === "upcoming") return 2;
  return 3;
}

function taskDueState(task: PlanTask, todayIso: string) {
  if (!task.due_date) return "none";
  if (task.due_date < todayIso) return "overdue";
  if (task.due_date === todayIso) return "today";
  return "upcoming";
}

function formatDueLabel(task: PlanTask, todayIso: string) {
  const state = taskDueState(task, todayIso);
  if (state === "overdue") return `已延期 ${task.due_date}`;
  if (state === "today") return "今天";
  if (state === "upcoming") return `截止 ${task.due_date}`;
  return "未排期";
}

function dateToLocalISO(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function localDateISO() {
  return dateToLocalISO(new Date());
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

function planGoalForCreate(space: Space | null, generateGoal: string) {
  return space?.goal?.trim() || generateGoal.trim() || "建立当前主题的基础理解，并形成可复习的笔记和问答记录。";
}

function planTitleForCreate(space: Space | null) {
  return space?.name ? `${space.name}学习计划` : "学习计划";
}

function defaultReviewPrompt(plan: LearningPlan, task: PlanTask) {
  return `请围绕当前学习计划“${plan.title}”中的任务“${task.title}”进行复习问答。先问我 3 个诊断问题，再根据我的回答指出薄弱点和下一步建议。`;
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "learning-plan";
}
