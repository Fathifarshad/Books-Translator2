import type { AgentTask } from '@dozabaneh/shared';
import { getLanguage } from '@dozabaneh/text';

/**
 * Prompt files live in prompts/ and are shared by every engine (SPEC §10.1). Each file starts with a heading that
 * carries its version («# Task: translate — v1»); the version is stored with every result.
 */
export const PROMPT_REFS: Record<AgentTask, string> = {
  brief: 'prompts/brief.md',
  glossary: 'prompts/glossary.md',
  translate: 'prompts/translate.md',
  edit: 'prompts/edit.md',
  summary: 'prompts/summary.md',
  quiz: 'prompts/quiz.md',
  tutor_answer: 'prompts/tutor.md',
};

/** The style guide of a target language (registry entry `styleGuide`), if it has one. */
export function styleGuideRef(lang: string): string | undefined {
  return getLanguage(lang).styleGuide;
}

/** Prompt files an agent must read for a task: the task prompt, then the target language's style guide. */
export function promptRefsFor(task: AgentTask, targetLang: string): string[] {
  const style = styleGuideRef(targetLang);
  return style ? [PROMPT_REFS[task], style] : [PROMPT_REFS[task]];
}

/** "v1" from «# Task: translate — v1»; "v0" when the heading has no version. */
export function promptVersion(text: string): string {
  const heading = text.split('\n').find((l) => l.startsWith('#')) ?? '';
  return /\bv(\d+)\s*$/u.exec(heading.trim())?.[0].trim() ?? 'v0';
}

/** Fills {{sourceLanguage}}, {{targetLanguage}} and {{styleGuideRef}}; unknown placeholders are left as they are. */
export function renderPrompt(text: string, vars: { sourceLang: string; targetLang: string }): string {
  const values: Record<string, string> = {
    sourceLanguage: getLanguage(vars.sourceLang).name,
    targetLanguage: getLanguage(vars.targetLang).name,
    styleGuideRef: styleGuideRef(vars.targetLang) ?? 'the style guide',
  };
  return text.replace(/\{\{(\w+)\}\}/gu, (m, name: string) => values[name] ?? m);
}

export type PromptReader = (ref: string) => string;

export interface LoadedPrompt {
  refs: string[];
  /** Version of the task prompt (e.g. "v1"). */
  version: string;
  /** Rendered task prompt followed by the style guide — the system prompt of API engines. */
  system: string;
}

export function loadTaskPrompt(
  task: AgentTask,
  langs: { sourceLang: string; targetLang: string },
  read: PromptReader,
): LoadedPrompt {
  const refs = promptRefsFor(task, langs.targetLang);
  const [taskRef, ...rest] = refs;
  const taskText = read(taskRef as string);
  const system = [renderPrompt(taskText, langs), ...rest.map((r) => read(r))].join('\n\n---\n\n');
  return { refs, version: promptVersion(taskText), system };
}
