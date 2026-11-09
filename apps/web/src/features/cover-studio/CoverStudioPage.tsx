import { newLayerId, withTexts } from '@dozabaneh/cover';
import { BOOK_PAGE_MM, type CoverDesign, type CoverDesignView, type CoverLayer } from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, IconButton } from '../../components/ui';
import { uiLocale } from '../../i18n';
import { ApiError, api } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { targetOf } from '../pipeline/live';
import { BackgroundPanel } from './BackgroundPanel';
import { CoverCanvas, type DesignUpdate } from './CoverCanvas';
import { CoverView, type LayerBoxes } from './CoverView';
import { type CoverIssue, useCoverIssues } from './checks';
import { fieldClass } from './controls';
import { useHistory } from './history';
import { LayerInspector } from './LayerInspector';
import { LayersPanel, layerName } from './LayersPanel';

type Tab = 'layers' | 'background' | 'templates';
type SaveState = 'saved' | 'pending' | 'saving' | 'failed';

const viewKey = (bookId: string, lang: string) => ['cover-design', bookId, lang] as const;

/**
 * «استودیوی جلد» (ADR-048): the book's cover as layers — every text editable, in any Persian face (the app's or this
 * computer's), placed by dragging or on the layout grid; the ground a colour, a gradient or an image; checks for
 * readability and the safe area; a thumbnail at the size an online shop shows; undo and redo; templates for the next
 * book. Every change is saved a moment later, and the next «کتاب PDF» prints this cover.
 */
export function CoverStudioPage() {
  const { t } = useTranslation();
  const { bookId = '' } = useParams();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['book', bookId], queryFn: () => api.book(bookId), enabled: Boolean(bookId) });
  const book = detail.data?.book;
  const lang = book ? targetOf(book) : '';

  const view = useQuery({
    queryKey: viewKey(bookId, lang),
    queryFn: () => api.coverDesign(bookId, lang || undefined),
    enabled: Boolean(bookId && lang),
    refetchOnWindowFocus: false,
  });
  const pdf = useQuery({
    queryKey: ['book-pdf', bookId],
    queryFn: () => api.bookPdf(bookId, lang || undefined),
    enabled: Boolean(bookId && lang),
  });
  const fonts = useQuery({
    queryKey: ['cover-fonts'],
    queryFn: () => api.fonts(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const templates = useQuery({ queryKey: ['cover-templates'], queryFn: () => api.coverTemplates() });

  const mm = BOOK_PAGE_MM[pdf.data?.options.pageSize ?? 'a4'];
  const aspect = mm.width / mm.height;

  const history = useHistory<CoverDesign | null>(null);
  const design = history.value;
  const loaded = useRef(false);
  const lastSaved = useRef<CoverDesign | null>(null);
  useEffect(() => {
    if (view.data && !loaded.current) {
      loaded.current = true;
      lastSaved.current = view.data.design;
      history.reset(view.data.design);
    }
  }, [view.data, history.reset]);

  const update: DesignUpdate = useCallback((fn, key) => history.set((d) => (d ? fn(d) : d), key), [history.set]);

  // ── Saving: a moment after the last change, and when the page is left ──────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const save = useMutation({
    mutationFn: (d: CoverDesign) => api.saveCoverDesign(bookId, d, lang || undefined),
    onMutate: () => setSaveState('saving'),
    onSuccess: (next, d) => {
      lastSaved.current = d;
      queryClient.setQueryData<CoverDesignView>(viewKey(bookId, lang), (old) =>
        old ? { ...next, design: old.design } : next,
      );
      void queryClient.invalidateQueries({ queryKey: ['book-pdf', bookId] });
      setSaveState('saved');
    },
    onError: () => setSaveState('failed'),
  });
  const pendingDesign = useRef<CoverDesign | null>(null);
  useEffect(() => {
    if (!design || design === lastSaved.current) return;
    pendingDesign.current = design;
    setSaveState('pending');
    const timer = setTimeout(() => {
      pendingDesign.current = null;
      save.mutate(design);
    }, 800);
    return () => clearTimeout(timer);
  }, [design, save.mutate]);
  useEffect(
    () => () => {
      // Leaving with a change not yet sent: send it now.
      if (pendingDesign.current)
        void api.saveCoverDesign(bookId, pendingDesign.current, lang || undefined).catch(() => {});
    },
    [bookId, lang],
  );

  // ── Selection, layout, checks ──────────────────────────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<LayerBoxes>({});
  const [tab, setTab] = useState<Tab>('layers');
  const [guides, setGuides] = useState(true);
  const issues = useCoverIssues(design ?? EMPTY, boxes, aspect, bookId);
  const flagged = useMemo(() => new Set(issues.map((i) => i.layer)), [issues]);
  const layer = design?.layers.find((l) => l.id === selected);

  const remove = useCallback(
    (id: string) => {
      update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
      setSelected(null);
    },
    [update],
  );
  const duplicate = (id: string) => {
    let copyId = '';
    update((d) => {
      const src = d.layers.find((l) => l.id === id);
      if (!src) return d;
      copyId = newLayerId(d, src.kind === 'text' ? src.role : src.shape);
      const copy = { ...src, id: copyId, y: Math.min(110, src.y + 4) } as CoverLayer;
      const i = d.layers.indexOf(src);
      return { ...d, layers: [...d.layers.slice(0, i + 1), copy, ...d.layers.slice(i + 1)] };
    });
    setTimeout(() => copyId && setSelected(copyId), 0);
  };

  // Undo / redo from the keyboard, unless a text field has the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history.undo, history.redo]);

  // ── Images ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const setImages = (images: CoverDesignView['images']) =>
    queryClient.setQueryData<CoverDesignView>(viewKey(bookId, lang), (old) => (old ? { ...old, images } : old));
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadCoverImage(bookId, file),
    onSuccess: (img) => {
      setImages([img, ...(view.data?.images ?? [])]);
      update((d) => ({
        ...d,
        background: { ...d.background, kind: 'image', image: img.id, focusX: 50, focusY: 50, zoom: 1, blur: 0 },
      }));
    },
  });
  const removeImage = useMutation({
    mutationFn: (id: string) => api.removeCoverImage(bookId, id),
    onSuccess: setImages,
  });

  // ── Reset and templates ────────────────────────────────────────────────────────────────────────────────────────
  const reset = useMutation({
    mutationFn: () => api.resetCoverDesign(bookId, lang || undefined),
    onSuccess: (next) => {
      queryClient.setQueryData(viewKey(bookId, lang), next);
      lastSaved.current = next.design;
      history.set(next.design);
      setSelected(null);
    },
  });
  const [templateName, setTemplateName] = useState('');
  const addTemplate = useMutation({
    mutationFn: (name: string) => api.addCoverTemplate(name, design as CoverDesign),
    onSuccess: (list) => {
      queryClient.setQueryData(['cover-templates'], list);
      setTemplateName('');
    },
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => api.removeCoverTemplate(id),
    onSuccess: (list) => queryClient.setQueryData(['cover-templates'], list),
  });

  const failure = view.error ?? detail.error;
  const outdated = failure instanceof ApiError && failure.status === 404 && failure.code === 'NOT_FOUND';

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-[90rem] px-4 py-6 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          to={`/books/${bookId}/book-pdf`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
        >
          <Icon name="back" size={16} />
          {t('coverStudio.backToBookPdf')}
        </Link>
        <div className="ms-auto flex items-center gap-1">
          <IconButton
            icon="undo"
            label={t('coverStudio.undo')}
            onClick={history.undo}
            disabled={!history.canUndo}
            data-testid="undo"
          />
          <IconButton
            icon="redo"
            label={t('coverStudio.redo')}
            onClick={history.redo}
            disabled={!history.canRedo}
            data-testid="redo"
          />
          <IconButton
            icon="grid"
            label={t('coverStudio.guides')}
            onClick={() => setGuides((g) => !g)}
            aria-pressed={guides}
            className={guides ? 'text-accent' : ''}
            data-testid="toggle-guides"
          />
          <span className="ms-2 text-xs text-muted" role="status" data-testid="save-state">
            {t(`coverStudio.save.${saveState}`)}
          </span>
        </div>
      </div>
      <h1 className="mt-3 text-2xl font-bold">{t('coverStudio.title')}</h1>
      {book ? (
        <p className="mt-1 text-sm text-muted">
          <LangText lang={lang || book.sourceLang}>{book.titles[lang] ?? book.titles[book.sourceLang] ?? ''}</LangText>
        </p>
      ) : null}

      {failure ? (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {outdated ? t('bookPdf.errors.SERVER_OUTDATED') : t('bookPdf.errors.generic')}
        </p>
      ) : null}

      {design ? (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
          {/* Canvas, thumbnail and checks */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="rounded-2xl bg-[repeating-conic-gradient(var(--color-panel)_0%_25%,var(--color-surface)_0%_50%)] bg-[length:22px_22px] p-4 sm:p-8">
              <div className="mx-auto" style={{ maxWidth: `min(100%, calc((100dvh - 10rem) * ${aspect}))` }}>
                <CoverCanvas
                  design={design}
                  bookId={bookId}
                  aspect={aspect}
                  selected={selected}
                  onSelect={(id) => {
                    setSelected(id);
                    if (id) setTab('layers');
                  }}
                  update={update}
                  onRemove={remove}
                  guides={guides}
                  flagged={flagged}
                  boxes={boxes}
                  onLayout={setBoxes}
                />
              </div>
            </div>
            <p className="text-xs leading-6 text-muted">{t('coverStudio.canvasHint')}</p>

            <div className="flex flex-wrap items-start gap-5">
              <figure className="m-0 flex flex-col items-center gap-1.5">
                <div className="w-[5.5rem] overflow-hidden rounded-[2px] shadow-md">
                  <CoverView design={design} bookId={bookId} aspect={aspect} uid="thumb" testId="cover-thumb" />
                </div>
                <figcaption className="max-w-[7rem] text-center text-[11px] leading-5 text-muted">
                  {t('coverStudio.thumbnail')}
                </figcaption>
              </figure>
              <Issues issues={issues} design={design} onSelect={(id) => setSelected(id)} />
            </div>
          </div>

          {/* Panels */}
          <aside className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto">
            <div role="tablist" aria-label={t('coverStudio.panels')} className="flex gap-1 border-b border-border">
              {(['layers', 'background', 'templates'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted aria-selected:border-accent aria-selected:font-bold aria-selected:text-text"
                  data-testid={`tab-${id}`}
                >
                  {t(`coverStudio.tabs.${id}`)}
                </button>
              ))}
            </div>

            {tab === 'layers' ? (
              <>
                <LayersPanel
                  design={design}
                  selected={selected}
                  onSelect={setSelected}
                  update={update}
                  texts={view.data?.texts ?? {}}
                  issues={flagged}
                />
                {layer ? (
                  <div className="border-t border-border pt-4">
                    <h2 className="mb-3 text-sm font-bold">{layerName(layer, t)}</h2>
                    <LayerInspector
                      design={design}
                      layer={layer}
                      update={update}
                      fonts={fonts.data ?? []}
                      texts={view.data?.texts ?? {}}
                      boxes={boxes}
                      aspect={aspect}
                      onRemove={remove}
                      onDuplicate={duplicate}
                    />
                  </div>
                ) : (
                  <p className="border-t border-border pt-4 text-sm text-muted">{t('coverStudio.selectHint')}</p>
                )}
              </>
            ) : null}

            {tab === 'background' ? (
              <BackgroundPanel
                bookId={bookId}
                design={design}
                update={update}
                images={view.data?.images ?? []}
                onUpload={(f) => upload.mutate(f)}
                uploading={upload.isPending}
                uploadFailed={upload.isError}
                onRemoveImage={(id) => removeImage.mutate(id)}
              />
            ) : null}

            {tab === 'templates' ? (
              <section className="flex flex-col gap-4" data-testid="templates-panel">
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (templateName.trim()) addTemplate.mutate(templateName.trim());
                  }}
                >
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t('coverStudio.templateName')}
                    <input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      className={fieldClass}
                      maxLength={80}
                      data-testid="template-name"
                    />
                  </label>
                  <Button
                    type="submit"
                    icon="plus"
                    disabled={!templateName.trim() || addTemplate.isPending}
                    data-testid="save-template"
                  >
                    {t('coverStudio.saveTemplate')}
                  </Button>
                  <p className="text-xs leading-6 text-muted">{t('coverStudio.templateHint')}</p>
                </form>
                {templates.data?.length ? (
                  <ul className="grid grid-cols-2 gap-3" data-testid="template-list">
                    {templates.data.map((tpl) => (
                      <li key={tpl.id} className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => update(() => withTexts(tpl.design, view.data?.texts ?? {}))}
                          className="overflow-hidden rounded border border-border hover:border-accent"
                          aria-label={t('coverStudio.applyTemplate', { name: tpl.name })}
                          data-testid={`template-${tpl.id}`}
                        >
                          <CoverView
                            design={withTexts(tpl.design, view.data?.texts ?? {})}
                            bookId={bookId}
                            aspect={aspect}
                            uid={tpl.id}
                          />
                        </button>
                        <div className="flex items-center gap-1 text-xs">
                          <span className="min-w-0 flex-1 truncate">{tpl.name}</span>
                          <button
                            type="button"
                            onClick={() => removeTemplate.mutate(tpl.id)}
                            aria-label={t('coverStudio.removeTemplate', { name: tpl.name })}
                            title={t('coverStudio.removeTemplate', { name: tpl.name })}
                            className="rounded p-1 text-muted hover:text-danger"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                        <span className="text-[11px] text-muted">
                          {new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'medium' }).format(new Date(tpl.createdAt))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{t('coverStudio.noTemplates')}</p>
                )}
                <div className="border-t border-border pt-4">
                  <Button
                    variant="ghost"
                    icon="history"
                    onClick={() => {
                      if (window.confirm(t('coverStudio.resetConfirm'))) reset.mutate();
                    }}
                    data-testid="reset-design"
                  >
                    {t('coverStudio.reset')}
                  </Button>
                </div>
              </section>
            ) : null}

            <Link
              to={`/books/${bookId}/book-pdf`}
              className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
              data-testid="to-book-pdf"
            >
              <Icon name="book" size={16} />
              {t('coverStudio.buildBook')}
            </Link>
          </aside>
        </div>
      ) : !failure ? (
        <p className="mt-8 text-sm text-muted">{t('coverStudio.loading')}</p>
      ) : null}
    </main>
  );
}

const EMPTY: CoverDesign = { v: 1, background: {} as CoverDesign['background'], layers: [] };

function Issues(props: { issues: CoverIssue[]; design: CoverDesign; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  const name = (id: string) => {
    const l = props.design.layers.find((x) => x.id === id);
    return l ? layerName(l, t) : id;
  };
  return (
    <section className="min-w-0 flex-1" aria-labelledby="checks-title" data-testid="cover-checks">
      <h2 id="checks-title" className="mb-1.5 text-sm font-bold">
        {t('coverStudio.checks')}
      </h2>
      {props.issues.length ? (
        <ul className="flex flex-col gap-1">
          {props.issues.map((i) => (
            <li key={`${i.kind}-${i.layer}`}>
              <button
                type="button"
                onClick={() => props.onSelect(i.layer)}
                className="flex items-start gap-1.5 text-start text-sm text-warning hover:underline"
                data-testid={`issue-${i.kind}-${i.layer}`}
              >
                <Icon name="warning" size={15} className="mt-1 shrink-0" />
                {i.kind === 'contrast'
                  ? t('coverStudio.issues.contrast', { name: name(i.layer), ratio: fmtNum(i.ratio ?? 0) })
                  : t('coverStudio.issues.safe', { name: name(i.layer) })}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-success" data-testid="checks-ok">
          <Icon name="check" size={15} />
          {t('coverStudio.issues.none')}
        </p>
      )}
    </section>
  );
}
