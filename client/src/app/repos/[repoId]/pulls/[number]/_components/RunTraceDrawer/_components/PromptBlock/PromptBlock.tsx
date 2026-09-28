/* PromptBlock — one labelled, collapsible prompt segment with copy + fullscreen
   actions; fullscreen opens PromptModalBody in a Modal.

   The header is a Disclosure: the toggle is a real <button> (Enter/Space work
   natively), and the copy/fullscreen buttons sit in `actions`, beside it — a
   button nested inside the toggle would be invalid and unreachable by Tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Disclosure, Icon, Modal } from "@devdigest/ui";
import { PROMPT_COPIED_FEEDBACK_MS, PROMPT_MODAL_WIDTH } from "../../constants";
import { s } from "../../styles";
import { PromptModalBody } from "../PromptModalBody";

export function PromptBlock({ label, text, color }: { label: string; text: string; color: string }) {
  const t = useTranslations("runs");
  const tShell = useTranslations("shell");
  const [full, setFull] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text || "");
    setCopied(true);
  };
  // Timer tied to the state it resets, so unmounting cancels it.
  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), PROMPT_COPIED_FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <>
      <Disclosure
        style={s.promptRow}
        headerStyle={s.promptHead}
        header={(open) => (
          <>
            <span style={s.promptDot(color)} />
            <span style={s.promptLabel}>{label}</span>
            <span style={s.promptToggle}>{open ? t("trace.collapse") : t("trace.expand")}</span>
          </>
        )}
        actions={
          <span style={s.promptActions}>
            <button
              type="button"
              title={t("trace.prompt.copy")}
              aria-label={t("trace.prompt.copy")}
              onClick={copy}
              style={s.miniBtn}
            >
              {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
            </button>
            <button
              type="button"
              title={t("trace.prompt.fullscreen")}
              aria-label={t("trace.prompt.fullscreen")}
              onClick={() => setFull(true)}
              style={s.miniBtn}
            >
              <Icon.ExternalLink size={12} />
            </button>
          </span>
        }
      >
        <pre className="mono" style={s.promptPre}>
          {text || t("trace.empty")}
        </pre>
      </Disclosure>
      {full && (
        <Modal
          width={PROMPT_MODAL_WIDTH}
          title={label}
          closeLabel={tShell("ui.close")}
          onClose={() => setFull(false)}
          footer={
            <Button kind="secondary" size="sm" icon={copied ? "Check" : "Copy"} onClick={copy}>
              {copied ? t("drawer.copied") : t("trace.prompt.copy")}
            </Button>
          }
        >
          <PromptModalBody text={text} />
        </Modal>
      )}
    </>
  );
}
