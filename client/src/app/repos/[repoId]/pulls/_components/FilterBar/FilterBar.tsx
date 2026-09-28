/* FilterBar — search box, status chips, sort select, and refresh for the PR list. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Button, TextInput, SelectInput } from "@devdigest/ui";
import { SORT_ORDERS, STATUS_FILTERS } from "../../constants";
import { isSortOrder, type SortOrder } from "../../helpers";
import { s } from "../../styles";

export function FilterBar({
  active,
  onActive,
  query,
  onQuery,
  sort,
  onSort,
  onRefresh,
  refreshing,
}: {
  active: string;
  onActive: (k: string) => void;
  query: string;
  onQuery: (v: string) => void;
  sort: SortOrder;
  onSort: (v: SortOrder) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations("prReview");
  const sortOptions = SORT_ORDERS.map((value) => ({ value, label: t(`list.sort.${value}`) }));
  return (
    <div style={s.filterBar}>
      <div style={s.filterChips}>
        <div style={s.searchBox}>
          <TextInput
            value={query}
            onChange={onQuery}
            placeholder={t("list.filterPlaceholder")}
            aria-label={t("list.searchLabel")}
          />
        </div>
        {/* A toggle group: each Chip carries aria-pressed (from `active`), so the
            selected status is not conveyed by colour alone. */}
        <div role="group" aria-label={t("list.statusFilterLabel")} style={s.filterChips}>
          {STATUS_FILTERS.map(({ key, labelKey }) => (
            <Chip key={key} active={active === key} onClick={() => onActive(key)}>
              {t(`list.filter.${labelKey}`)}
            </Chip>
          ))}
        </div>
      </div>
      <div style={s.filterActions}>
        <SelectInput
          value={sort}
          onChange={(v) => {
            if (isSortOrder(v)) onSort(v);
          }}
          options={sortOptions}
          mono={false}
        />
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? t("list.refreshing") : t("list.refresh")}
        </Button>
      </div>
    </div>
  );
}
