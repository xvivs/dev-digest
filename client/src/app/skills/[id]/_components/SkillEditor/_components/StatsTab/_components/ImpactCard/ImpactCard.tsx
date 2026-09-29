/* ImpactCard — "did this skill help?" (ADR 0017), first on the Stats tab.
   Null impact = no suite ever ran → Unknown plus a "Run evals" CTA. Otherwise
   the latest suite's verdict, its carrier and mode, and once it is done the
   pass rate and the caught / regressed / flaky / Δunexpected breakdown.
   Indicative and stale verdicts carry a note saying why they are weak. */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card, CircularScore, SectionLabel } from "@devdigest/ui";
import type { SkillImpact } from "@devdigest/shared";
import { EVAL_SUITE_TERMINAL_STATUSES } from "@devdigest/shared/contracts/skill-impact";
import { VerdictBadge } from "@/app/skills/_components/VerdictBadge";
import { formatSignedDelta, passRatePercent } from "@/app/skills/helpers";
import { s } from "./styles";

export function ImpactCard({ impact, onRunEvals }: { impact: SkillImpact | null; onRunEvals: () => void }) {
  const t = useTranslations("skills");
  const cta = (
    <Button kind="secondary" size="sm" icon="FlaskConical" onClick={onRunEvals}>
      {impact?.stale ? t("stats.impact.rerunEvals") : t("stats.impact.runEvals")}
    </Button>
  );

  return (
    <Card>
      <SectionLabel icon="Target" right={cta}>
        {t("stats.impact.title")}
      </SectionLabel>
      {impact === null ? (
        <div style={s.body}>
          <VerdictBadge verdict="unknown" />
          <p style={s.text}>{t("stats.impact.unknownBody")}</p>
        </div>
      ) : (
        <ImpactDetails impact={impact} />
      )}
    </Card>
  );
}

function ImpactDetails({ impact }: { impact: SkillImpact }) {
  const t = useTranslations("skills");
  const { suite, verdict, stale } = impact;
  const results = suite.results;
  const terminal = EVAL_SUITE_TERMINAL_STATUSES.includes(suite.status);

  return (
    <div style={s.body}>
      <div style={s.head}>
        <VerdictBadge verdict={verdict} stale={stale} />
        <Badge mono>{t(`stats.impact.mode.${suite.mode}`)}</Badge>
        <span style={s.muted}>
          {suite.carrier_name ? t("stats.impact.carrier", { name: suite.carrier_name }) : t("stats.impact.carrierDeleted")}
        </span>
      </div>

      {results ? (
        <div style={s.results}>
          <div role="img" aria-label={t("stats.impact.passRateAria", { percent: passRatePercent(results.passing, results.total) })}>
            <CircularScore score={passRatePercent(results.passing, results.total)} />
          </div>
          <div style={s.resultLines}>
            <span style={s.strong}>{t("stats.impact.passing", { passing: results.passing, total: results.total })}</span>
            <span style={s.muted}>
              {t("stats.impact.breakdown", { caught: results.caught, regressed: results.regressed, flaky: results.flaky })}
              {" · "}
              <span title={t("stats.impact.deltaUnexpectedTitle")}>
                {t("stats.impact.deltaUnexpected", { value: formatSignedDelta(results.delta_unexpected) })}
              </span>
            </span>
          </div>
        </div>
      ) : terminal ? (
        <p role="alert" style={s.text}>
          {suite.error ?? t("stats.impact.failed")}
        </p>
      ) : (
        <p role="status" style={s.text}>
          {t("stats.impact.running", { done: suite.done_jobs, total: suite.total_jobs })}
        </p>
      )}

      {verdict === "indicative" && <p style={s.note}>{t("stats.impact.indicativeNote")}</p>}
      {stale && <p style={s.warnNote}>{t("stats.impact.staleNote")}</p>}
    </div>
  );
}
