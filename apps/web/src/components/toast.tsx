'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';

type ToastType = 'success' | 'error';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastRecord {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  ttlMs?: number;
}

interface ToastOptions {
  action?: ToastAction;
  ttlMs?: number;
}

interface ToastContextValue {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast() must be called inside <ToastProvider>');
  }
  return ctx;
}

const SUCCESS_AUTO_DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const router = useRouter();
  const pathname = usePathname();

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string, options?: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, message, type, action: options?.action, ttlMs: options?.ttlMs }]);
      // Auto-dismiss: default 3s for success, custom ttlMs if provided
      // (Undo-style toasts pass 10_000). Error toasts without a ttl persist.
      const ttl = options?.ttlMs ?? (type === 'success' ? SUCCESS_AUTO_DISMISS_MS : undefined);
      if (ttl) {
        const timer = setTimeout(() => dismiss(id), ttl);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Story 8.2: global 403 listener. Shows a toast and redirects to project
  // home (or "/" if not in a project context). Local catchers still run —
  // accept the rare double-toast.
  useEffect(() => {
    const onForbidden = (evt: Event) => {
      const detail = (evt as CustomEvent).detail as {
        message?: string;
        action?: string;
      } | undefined;
      const message =
        detail?.message ??
        (detail?.action
          ? `You don't have permission for "${detail.action}"`
          : 'You do not have permission to perform that action');
      push('error', message);
      // Redirect to project home if we're in a project route, else "/".
      const match = pathname?.match(/^\/projects\/([^/]+)/);
      const target = match ? `/projects/${match[1]}` : '/';
      if (pathname !== target) router.replace(target);
    };
    window.addEventListener('mega:forbidden', onForbidden as EventListener);
    return () =>
      window.removeEventListener('mega:forbidden', onForbidden as EventListener);
  }, [pathname, router, push]);

  // Story 9.x (bug fix): the access token expired AND the refresh token
  // either expired or failed. The user is effectively logged out — show a
  // toast and bounce them to /login so they can sign back in. Guard against
  // double-firing on /login itself.
  useEffect(() => {
    const onSessionExpired = () => {
      if (pathname === '/login' || pathname === '/register') return;
      push('error', 'Your session expired. Please sign in again.');
      router.replace('/login');
    };
    window.addEventListener('mega:session-expired', onSessionExpired as EventListener);
    return () =>
      window.removeEventListener('mega:session-expired', onSessionExpired as EventListener);
  }, [pathname, router, push]);

  const success = useCallback(
    (m: string, options?: ToastOptions) => push('success', m, options),
    [push],
  );
  const error = useCallback(
    (m: string, options?: ToastOptions) => push('error', m, options),
    [push],
  );
  const value = useMemo(() => ({ success, error }), [success, error]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-40 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.type === 'error' ? 'alert' : 'status'}
          className={`flex items-center gap-3 px-3 py-2 rounded shadow-lg text-sm ${
            t.type === 'success'
              ? 'bg-[var(--color-status-green)] text-white'
              : 'bg-[var(--color-status-red)] text-white'
          }`}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onClick();
                onDismiss(t.id);
              }}
              className="ml-1 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-white font-medium"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
            className="text-white/80 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
