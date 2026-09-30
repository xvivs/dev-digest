/* RuleEditor — inline edit of a convention's rule and category (AC-37, D7).
   A draft seeded once from the props; the parent unmounts it on save or cancel,
   so a fresh edit always starts from the current rule. Escape cancels. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SelectInput, Textarea } from "@devdigest/ui";
import type { ConventionCategory } from "@devdigest/shared";
import { CATEGORY_OPTIONS, RULE_MAX_LENGTH } from "../../../../constants";
import { isRuleValid } from "../../../../helpers";
import { s } from "./styles";

export function RuleEditor({
  rule,
  category,
  onSave,
  onCancel,
}: {
  rule: string;
  category: ConventionCategory;
  onSave: (next: { rule: string; category: ConventionCategory }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("conventions");
  const [draftRule, setDraftRule] = React.useState(rule);
  const [draftCategory, setDraftCategory] = React.useState<ConventionCategory>(category);

  const options = CATEGORY_OPTIONS.map((c) => ({ value: c, label: t(`card.category.${c}`) }));
  const changed = draftRule.trim() !== rule || draftCategory !== category;
  const canSave = changed && isRuleValid(draftRule);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div style={s.wrap} onKeyDown={onKeyDown}>
      <Textarea aria-label={t("card.editRule")} value={draftRule} onChange={setDraftRule} rows={2} />
      <div style={s.row}>
        <div style={s.categoryField}>
          <SelectInput
            aria-label={t("card.editCategory")}
            value={draftCategory}
            onChange={(v) => setDraftCategory(v as ConventionCategory)}
            options={options}
            mono={false}
          />
        </div>
        <span style={s.count(draftRule.trim().length > RULE_MAX_LENGTH)}>
          {t("card.ruleHint", { count: draftRule.trim().length, max: RULE_MAX_LENGTH })}
        </span>
      </div>
      <div style={s.row}>
        <Button
          kind="primary"
          size="sm"
          icon="Check"
          disabled={!canSave}
          onClick={() => onSave({ rule: draftRule.trim(), category: draftCategory })}
        >
          {t("card.save")}
        </Button>
        <Button kind="ghost" size="sm" onClick={onCancel}>
          {t("card.cancel")}
        </Button>
      </div>
    </div>
  );
}
