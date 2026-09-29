/* RunEvalModal — "Run on evals" (plan Phase 3, ADR 0018 two-step start).
   1. Pick the carrier agent and Quick or Full. Only agents that link the
      skill with an enabled link are offered (GET /skills/:id/eval-carriers),
      the server's default is preselected; with none, the modal says to link
      the skill to an agent and Estimate stays disabled.
   2. Estimate → POST /skills/:id/eval-suites creates an `estimated` suite and
      shows its $ estimate and model-call count. Nothing runs yet.
   3. Start → POST /eval-suites/:id/start, then the tab polls the suite.
   Changing carrier or mode drops the estimate, so Start always runs what was
   priced. Both mutations own their errors (ADR 0011): the trust gate reads
   "vet skill first" with a way to Config, the rest map to their own copy. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { EvalSuite, EvalSuiteMode, Skill } from "@devdigest/shared";
import { useCreateEvalSuite, useSkillEvalCarriers, useStartEvalSuite } from "@/lib/hooks";
import { RunCostValue } from "@/components/run-cost-value";
import { RUN_MODAL_WIDTH, RUN_MODES, TRUST_GATE_CODE } from "./constants";
import { estimateCaseCount, preselectedCarrierId, runErrorCode } from "./helpers";
import { s } from "./styles";

export function RunEvalModal({
  skill,
  onClose,
  onStarted,
  onOpenConfig,
}: {
  skill: Skill;
  onClose: () => void;
  /** The suite is running. The tab already follows it: start invalidates the suite list. */
  onStarted?: (suite: EvalSuite) => void;
  /** Trust gate → go vet the skill in Config. */
  onOpenConfig: () => void;
}) {
  const t = useTranslations("eval");
  const tShell = useTranslations("shell");
  const carriers = useSkillEvalCarriers(skill.id);
  const create = useCreateEvalSuite({ meta: { errorSurface: "local" } });
  const start = useStartEvalSuite({ meta: { errorSurface: "local" } });
  const ids = { carrier: React.useId(), carrierHint: React.useId(), mode: React.useId() };

  const [carrierChoice, setCarrierChoice] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<EvalSuiteMode>("full");
  const carrierList = carriers.data ?? [];
  const noCarrier = carriers.isSuccess && carrierList.length === 0;
  // A stale choice (carrier no longer listed) falls back to the server default.
  const chosen = carrierList.some((c) => c.agent_id === carrierChoice) ? carrierChoice : null;
  const carrierId = chosen ?? preselectedCarrierId(carriers.data);
  const estimate = create.data ?? null;

  // A new carrier or mode invalidates the quote: Start must run what was priced.
  const resetEstimate = () => {
    create.reset();
    start.reset();
  };
  const pickCarrier = (id: string) => {
    setCarrierChoice(id);
    resetEstimate();
  };
  const pickMode = (m: EvalSuiteMode) => {
    setMode(m);
    resetEstimate();
  };

  const onEstimate = () => {
    if (!carrierId) return;
    start.reset();
    create.mutate(
      { skillId: skill.id, body: { carrier_agent_id: carrierId, mode } },
      // The link was disabled since the list loaded: refresh the offered carriers.
      { onError: (err) => runErrorCode(err) === "eval_carrier_not_linked" && carriers.refetch() },
    );
  };
  const onStart = () => {
    if (!estimate) return;
    start.mutate(
      { skillId: skill.id, suiteId: estimate.id },
      {
        onSuccess: (suite) => {
          onStarted?.(suite);
          onClose();
        },
        // The quote no longer matches the skill or carrier: drop it so the next click re-estimates.
        onError: (err) => {
          if (runErrorCode(err) === "eval_suite_stale") create.reset();
        },
      },
    );
  };

  const error = start.error ?? create.error;
  const code = error ? runErrorCode(error) : null;
  const busy = create.isPending || start.isPending;

  return (
    <Modal
      width={RUN_MODAL_WIDTH}
      title={t("skillEvals.runModal.title")}
      subtitle={t("skillEvals.runModal.subtitle")}
      closeLabel={tShell("ui.close")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("skillEvals.runModal.cancel")}
          </Button>
          {estimate ? (
            <Button kind="primary" icon="Play" onClick={onStart} disabled={busy}>
              {start.isPending ? t("skillEvals.runModal.starting") : t("skillEvals.runModal.start")}
            </Button>
          ) : (
            <Button kind="primary" icon="DollarSign" onClick={onEstimate} disabled={busy || !carrierId}>
              {create.isPending ? t("skillEvals.runModal.estimating") : t("skillEvals.runModal.estimate")}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.body}>
        {skill.needs_vetting && <div style={s.warning}>{t("skillEvals.runModal.vettingHint")}</div>}

        <div style={s.field}>
          <label htmlFor={ids.carrier} style={s.label}>
            {t("skillEvals.runModal.carrier")}
          </label>
          {noCarrier ? (
            <div style={s.hint}>
              <p style={s.noCarrier}>{t("skillEvals.runModal.noCarrier")}</p>
              <Link href="/agents">{t("skillEvals.runModal.openAgents")}</Link>
            </div>
          ) : (
            <select
              id={ids.carrier}
              aria-describedby={ids.carrierHint}
              value={carrierId ?? ""}
              onChange={(e) => pickCarrier(e.target.value)}
              disabled={!carriers.isSuccess}
              style={s.select}
            >
              {carrierList.map((c) => (
                <option key={c.agent_id} value={c.agent_id}>
                  {t("skillEvals.runModal.carrierOption", { name: c.agent_name, runs: c.runs })}
                </option>
              ))}
            </select>
          )}
          {!noCarrier && (
            <span id={ids.carrierHint} style={s.hint}>
              {t("skillEvals.runModal.carrierHint")}
            </span>
          )}
        </div>

        <fieldset style={s.fieldset}>
          <legend style={s.label}>{t("skillEvals.runModal.mode")}</legend>
          {RUN_MODES.map((m) => (
            <label key={m} style={s.radio}>
              <input type="radio" name={ids.mode} value={m} checked={mode === m} onChange={() => pickMode(m)} />
              <span>
                <span style={s.radioTitle}>{t(`skillEvals.runModal.${m}`)}</span>
                <span style={s.hint}>{t(`skillEvals.runModal.${m}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {estimate && (
          <div role="status" style={s.estimate}>
            <div style={s.estimateCost}>
              <span style={s.hint}>{t("skillEvals.runModal.estimateCost")}</span>
              <strong style={s.cost}>
                <RunCostValue usd={estimate.estimate_usd} source="estimated" />
              </strong>
            </div>
            <span style={s.estimateLine}>
              {t("skillEvals.runModal.estimateLine", {
                calls: estimate.total_jobs,
                cases: estimateCaseCount(estimate),
                repeats: estimate.repeats,
              })}
            </span>
            <span style={s.hint}>{t("skillEvals.runModal.model", { model: estimate.model })}</span>
          </div>
        )}

        {error && (
          <div role="alert" style={s.error}>
            <span>
              {code
                ? t(`skillEvals.runModal.errors.${code}`)
                : t("skillEvals.runModal.errors.generic", { message: error.message })}
            </span>
            {code === TRUST_GATE_CODE && (
              <Button kind="secondary" size="sm" icon="Shield" onClick={onOpenConfig}>
                {t("skillEvals.runModal.openConfig")}
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
