import type { Budget } from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { uiLocale } from '../../i18n';
import { api } from '../../lib/api';
import { fmtNum } from '../../lib/format';

const field = 'w-32 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent/60';
const budgetKey = ['settings', 'budget'] as const;

/** An empty box is «no ceiling». */
const parse = (value: string): number | null => {
  const n = Number(value.trim());
  return value.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
};
const show = (n: number | null) => (n === null ? '' : String(n));

/** Settings → «سقف هزینه» (ADR-043): a daily and a monthly ceiling for the engines charged per token. */
export function BudgetSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const budget = useQuery({ queryKey: budgetKey, queryFn: api.budget, retry: false });
  const [daily, setDaily] = useState('');
  const [monthly, setMonthly] = useState('');
  useEffect(() => {
    if (!budget.data) return;
    setDaily(show(budget.data.dailyUsd));
    setMonthly(show(budget.data.monthlyUsd));
  }, [budget.data]);
  const save = useMutation({
    mutationFn: (next: Budget) => api.setBudget(next),
    onSuccess: (data) => queryClient.setQueryData(budgetKey, data),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ dailyUsd: parse(daily), monthlyUsd: parse(monthly) });
  };
  const b = budget.data;
  const money = (n: number) => fmtNum(Math.round(n * 100) / 100);

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5" data-testid="budget-section">
      <h2 className="mb-2 text-lg font-bold">{t('budget.title')}</h2>
      <p className="text-sm leading-7 text-muted">{t('budget.intro')}</p>
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t('budget.daily')}</span>
          <input
            type="number"
            min={0}
            step="0.5"
            inputMode="decimal"
            dir="ltr"
            className={field}
            value={daily}
            placeholder={t('budget.none')}
            onChange={(e) => setDaily(e.target.value)}
            data-testid="budget-daily"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t('budget.monthly')}</span>
          <input
            type="number"
            min={0}
            step="1"
            inputMode="decimal"
            dir="ltr"
            className={field}
            value={monthly}
            placeholder={t('budget.none')}
            onChange={(e) => setMonthly(e.target.value)}
            data-testid="budget-monthly"
          />
        </label>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isSuccess ? t('budget.saved') : t('budget.save')}
        </Button>
      </form>
      {b ? (
        <p className="mt-3 text-sm text-muted" data-testid="budget-spent">
          {t('budget.spent', { today: money(b.spentToday), month: money(b.spentMonth) })}
        </p>
      ) : null}
      {b?.blocked && b.resetsAt ? (
        <p className="mt-2 text-sm font-medium text-warning" role="status">
          {t('budget.blocked', { when: new Date(b.resetsAt).toLocaleString(uiLocale()) })}
        </p>
      ) : null}
    </section>
  );
}
