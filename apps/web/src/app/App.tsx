import { getLanguage } from '@dozabaneh/text';
import { QueryClientProvider } from '@tanstack/react-query';
import { Direction } from 'radix-ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Link, Outlet } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { queryClient } from '../data/books';
import { LibraryPage } from '../features/library/LibraryPage';
import { ReaderPage } from '../features/reader/ReaderPage';
import { useMediaQuery } from '../lib/hooks';
import { useSettings } from '../stores/settings';

/** Applies the UI language/direction and the theme to <html> (RTL-first shell, SPEC §3.1). */
function Shell() {
  const { t, i18n } = useTranslation();
  const theme = useSettings((s) => s.theme);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const lang = getLanguage(i18n.language);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = i18n.language;
    html.dir = lang.dir;
  }, [i18n.language, lang.dir]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  }, [theme, prefersDark]);

  useEffect(() => {
    document.title = t('app.name');
  }, [t]);

  return (
    <Direction.Provider dir={lang.dir}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent"
      >
        {t('app.skipToContent')}
      </a>
      <Outlet />
    </Direction.Provider>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <main id="main" className="mx-auto max-w-xl px-5 py-20 text-center">
      <p className="text-lg">{t('app.notFound')}</p>
      <Link to="/" className="mt-4 inline-block text-accent underline">
        {t('app.backHome')}
      </Link>
    </main>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <LibraryPage /> },
      // Secondary screens are code-split (SPEC §11.13).
      {
        path: '/books/new',
        lazy: async () => ({ Component: (await import('../features/setup/AddBookPage')).AddBookPage }),
      },
      {
        path: '/books/:bookId/setup',
        lazy: async () => ({ Component: (await import('../features/setup/SetupPage')).SetupPage }),
      },
      { path: '/books/:bookId/read/:nodeId?', element: <ReaderPage /> },
      {
        path: '/books/:bookId/quiz/:chapterId',
        lazy: async () => ({ Component: (await import('../features/quiz/QuizPage')).QuizPage }),
      },
      {
        path: '/settings',
        lazy: async () => ({ Component: (await import('../features/settings/SettingsPage')).SettingsPage }),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
