import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LandingPage } from '@/components/landing/LandingPage';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';

/**
 * Splitting the chat out means one more network fetch, right at the moment
 * someone has just signed in on a patchy mobile connection. A single dropped
 * request there would otherwise dead-end at the error boundary, so give it a
 * couple of retries with a short backoff before letting it fail.
 */
function lazyWithRetry<T>(load: () => Promise<T>, attempts = 3, delayMs = 400): Promise<T> {
  return load().catch((error: unknown) => {
    if (attempts <= 1) throw error;
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        lazyWithRetry(load, attempts - 1, delayMs * 2).then(resolve, reject);
      }, delayMs);
    });
  });
}

// The landing page is the first thing loaded on a borrowed phone, often on
// slow data — so the whole chat interface (message list, settings, the
// encryption UI) is fetched only once someone has actually signed in,
// instead of riding along in the initial bundle where it can't be used yet.
const ChatPage = lazy(() =>
  lazyWithRetry(() => import('@/components/chat/ChatPage')).then((module) => ({
    default: module.ChatPage,
  })),
);

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <Suspense fallback={<FullScreenLoader />}>
              <ChatPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
