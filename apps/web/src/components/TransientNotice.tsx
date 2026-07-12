import { useEffect } from "react";

type TransientNoticeProps = {
  message: string;
  tone?: "success" | "danger";
  onDismiss: () => void;
};

export function TransientNotice({ message, tone, onDismiss }: TransientNoticeProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return <div className={`notice ${tone ?? ""}`.trim()}>{message}</div>;
}
