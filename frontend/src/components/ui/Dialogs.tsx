"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Modal } from "@/components/Modal";

// ✅ ยืนยัน / กรอกข้อความ / แจ้งผล (แทน DialogHelper.ShowConfirm / ShowTextInput / ShowSuccess ของ WPF) - ใช้แบบ await
type ConfirmOpt = { title?: string; message: React.ReactNode; ok?: string; danger?: boolean };
type PromptOpt = ConfirmOpt & { placeholder?: string; initial?: string; required?: string; multiline?: boolean; numeric?: boolean };
type AlertOpt = { title?: string; message: React.ReactNode; tone?: "ok" | "warn" | "error" };
type State =
  | { kind: "confirm"; opt: ConfirmOpt; resolve: (v: boolean) => void }
  | { kind: "prompt"; opt: PromptOpt; resolve: (v: string | null) => void }
  | { kind: "alert"; opt: AlertOpt; resolve: () => void }
  | null;

type Api = {
  confirm: (o: ConfirmOpt | string) => Promise<boolean>;
  prompt: (o: PromptOpt) => Promise<string | null>;
  alert: (o: AlertOpt | string) => Promise<void>;
};
const Ctx = createContext<Api | null>(null);

const ALERT_COLOR = { ok: "var(--success)", warn: "var(--warning)", error: "var(--danger)" };

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  const confirm = useCallback(
    (o: ConfirmOpt | string) => new Promise<boolean>((resolve) => setState({ kind: "confirm", opt: typeof o === "string" ? { message: o } : o, resolve })),
    [],
  );
  const prompt = useCallback(
    (o: PromptOpt) =>
      new Promise<string | null>((resolve) => {
        setText(o.initial ?? "");
        setErr("");
        setState({ kind: "prompt", opt: o, resolve });
      }),
    [],
  );
  const alert = useCallback(
    (o: AlertOpt | string) => new Promise<void>((resolve) => setState({ kind: "alert", opt: typeof o === "string" ? { message: o } : o, resolve })),
    [],
  );

  const close = (ok: boolean) => {
    if (!state) return;
    if (state.kind === "confirm") state.resolve(ok);
    else if (state.kind === "alert") state.resolve();
    else {
      if (ok && state.opt.required && !text.trim()) return setErr(state.opt.required);
      state.resolve(ok ? text.trim() : null);
    }
    setState(null);
  };

  const tone = state?.kind === "alert" ? ALERT_COLOR[state.opt.tone ?? "ok"] : undefined;
  const okLabel = state && state.kind !== "alert" ? state.opt.ok ?? "CONFIRM" : "CONFIRM";
  const danger = state && state.kind !== "alert" ? !!state.opt.danger : false;

  return (
    <Ctx.Provider value={{ confirm, prompt, alert }}>
      {children}
      <Modal
        open={!!state}
        title={state?.opt.title ?? (state?.kind === "prompt" ? "INPUT" : state?.kind === "alert" ? "RESULT" : "CONFIRM")}
        onClose={() => close(false)}
        footer={
          state?.kind === "alert" ? (
            <button className="btn" style={{ background: tone }} onClick={() => close(true)} autoFocus>
              OK
            </button>
          ) : (
            <>
              <button className="btn-ghost" onClick={() => close(false)}>
                CANCEL
              </button>
              <button
                className="btn"
                style={{ background: danger ? "var(--danger)" : "var(--accent)" }}
                onClick={() => close(true)}
                autoFocus={state?.kind === "confirm"}
              >
                {okLabel}
              </button>
            </>
          )
        }
      >
        {state?.kind === "alert" && <div className="mb-3 h-1.5 w-16 rounded-full" style={{ background: tone }} />}
        <div className="whitespace-pre-line text-sm font-semibold">{state?.opt.message}</div>
        {state?.kind === "prompt" &&
          (state.opt.multiline ? (
            <textarea autoFocus rows={3} className="field mt-4" placeholder={state.opt.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <input
              autoFocus
              className="field mt-4"
              inputMode={state.opt.numeric ? "decimal" : undefined}
              placeholder={state.opt.placeholder}
              value={text}
              onChange={(e) => setText(state.opt.numeric ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && close(true)}
            />
          ))}
        {err && <div className="mt-2 text-sm font-bold text-danger">{err}</div>}
      </Modal>
    </Ctx.Provider>
  );
}

export function useDialogs() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDialogs must be inside DialogProvider");
  return c;
}
