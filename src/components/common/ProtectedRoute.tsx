import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { FullScreenLoader } from './FullScreenLoader';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, isInitializing } = useAuth();
  if (isInitializing) return <FullScreenLoader />;
  if (!session) return <Navigate to="/" replace />;
  return <>{children}</>;
}
