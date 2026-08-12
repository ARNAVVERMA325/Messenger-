import { Navigate, Route, Routes } from 'react-router-dom';
import { LandingPage } from '@/components/landing/LandingPage';
import { ChatPage } from '@/components/chat/ChatPage';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
