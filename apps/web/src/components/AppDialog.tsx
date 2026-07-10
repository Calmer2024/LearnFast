import { WarningCircle, X } from "@phosphor-icons/react";
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AppConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
};

export type AppPromptOptions = AppConfirmOptions & {
  defaultValue?: string;
  inputLabel?: string;
  multiline?: boolean;
  placeholder?: string;
};

export type AppConfirm = (options: AppConfirmOptions) => Promise<boolean>;
export type AppPrompt = (options: AppPromptOptions) => Promise<string | null>;

type DialogResolution = boolean | string | null;

type DialogState =
  | (AppConfirmOptions & {
      kind: "confirm";
    })
  | (AppPromptOptions & {
      kind: "prompt";
      value: string;
    });

export function useAppDialog() {
  const [state, setState] = useState<DialogState | null>(null);
  const resolverRef = useRef<((value: DialogResolution) => void) | null>(null);

  const resolveAndClose = useCallback((value: DialogResolution) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState(null);
  }, []);

  const confirm = useCallback<AppConfirm>((options) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = (value) => resolve(Boolean(value));
      setState({
        kind: "confirm",
        ...options,
      });
    });
  }, []);

  const prompt = useCallback<AppPrompt>((options) => {
    resolverRef.current?.(null);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = (value) => resolve(typeof value === "string" ? value : null);
      setState({
        kind: "prompt",
        value: options.defaultValue ?? "",
        ...options,
      });
    });
  }, []);

  return {
    confirm,
    prompt,
    node:
      state && typeof document !== "undefined"
        ? createPortal(<AppDialog state={state} onResolve={resolveAndClose} />, document.body)
        : null,
  };
}

function AppDialog({
  state,
  onResolve,
}: {
  state: DialogState;
  onResolve: (value: DialogResolution) => void;
}) {
  const [value, setValue] = useState(state.kind === "prompt" ? state.value : "");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const cancelValue = state.kind === "prompt" ? null : false;

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onResolve(cancelValue);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cancelValue, onResolve]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onResolve(state.kind === "prompt" ? value : true);
  };

  return (
    <div className="modal-backdrop app-dialog-backdrop" onMouseDown={() => onResolve(cancelValue)}>
      <section
        aria-modal="true"
        className={`app-dialog ${state.variant === "danger" ? "danger" : ""}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="app-dialog-form" onSubmit={submit}>
          <div className="app-dialog-head">
            <span className="app-dialog-icon" aria-hidden="true">
              <WarningCircle size={21} weight="bold" />
            </span>
            <div>
              <h3>{state.title}</h3>
              {state.body && (
                <div className="app-dialog-body">
                  {typeof state.body === "string" ? <p>{state.body}</p> : state.body}
                </div>
              )}
            </div>
            <button
              aria-label="关闭"
              className="icon-button app-dialog-close"
              onClick={() => onResolve(cancelValue)}
              type="button"
            >
              <X size={16} />
            </button>
          </div>

          {state.kind === "prompt" && (
            <label className="app-dialog-field">
              {state.inputLabel ?? "内容"}
              {state.multiline ? (
                <textarea
                  ref={(element) => {
                    inputRef.current = element;
                  }}
                  className="app-dialog-input"
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={state.placeholder}
                  rows={4}
                  value={value}
                />
              ) : (
                <input
                  ref={(element) => {
                    inputRef.current = element;
                  }}
                  className="app-dialog-input"
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={state.placeholder}
                  value={value}
                />
              )}
            </label>
          )}

          <div className="app-dialog-actions">
            <button className="button ghost" onClick={() => onResolve(cancelValue)} type="button">
              {state.cancelLabel ?? "取消"}
            </button>
            <button className={`button ${state.variant === "danger" ? "danger" : ""}`.trim()}>
              {state.confirmLabel ?? "确认"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
