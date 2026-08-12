import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/" replace />;
  return <>{children}</>;
}
