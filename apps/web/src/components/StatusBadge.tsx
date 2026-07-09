const labels: Record<string, string> = {
  active: "活跃",
  archived: "已归档",
  uploaded: "已上传",
  imported: "已导入",
  queued: "排队中",
  converting: "转换中",
  converted: "已转换",
  chunking: "分块中",
  indexing: "索引中",
  ready: "可问答",
  failed: "失败",
  configured: "已配置",
  connected: "已连接",
  not_configured: "未配置",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{labels[status] ?? status}</span>;
}
