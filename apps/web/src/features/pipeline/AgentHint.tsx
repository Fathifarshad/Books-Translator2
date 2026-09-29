import { Popover } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button, IconButton } from '../../components/ui';
import { fmtNum } from '../../lib/format';

/**
 * «۱۲ بسته در انتظار Claude Code» with a copy button for the `/process-batches` command and a short help popover
 * (SPEC §10.3-8). Shown wherever agent work is pending.
 */
export function AgentHint({ count, className = '' }: { count: number; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (count <= 0) return null;
  const command = `/process-batches ${Math.min(count, 20)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context): the command stays visible to copy by hand.
    }
  };
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/30 bg-accent-soft/50 px-4 py-3 ${className}`}
      role="status"
      data-testid="agent-hint"
    >
      <Icon name="sparkle" size={18} className="text-accent" />
      <p className="font-medium">{t('pipeline.agentPending', { count: fmtNum(count) })}</p>
      <div className="flex w-full flex-wrap items-center gap-2 sm:ms-auto sm:w-auto">
        <span className="text-xs text-muted">{t('pipeline.agentHint')}</span>
        <code
          dir="ltr"
          className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-sm"
          data-testid="agent-command"
        >
          {command}
        </code>
        <Button icon={copied ? 'check' : 'copy'} onClick={() => void copy()} className="px-2 py-1 text-xs">
          {copied ? t('pipeline.copied') : t('pipeline.copy')}
        </Button>
        <Popover.Root>
          <Popover.Trigger asChild>
            <IconButton icon="info" label={t('pipeline.agentHelpLabel')} className="size-8" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={6}
              className="z-50 w-72 rounded-xl border border-border bg-surface p-3 text-sm leading-7 shadow-[var(--shadow-popover)]"
            >
              {t('pipeline.agentHelp')}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
