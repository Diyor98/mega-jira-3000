'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { acquireSocket, releaseSocket } from '../lib/socket-client';

type EventHandler = (data: unknown) => void;

interface UseWebSocketOptions {
  projectKey: string;
  events?: Record<string, EventHandler>;
  onReconnectRefresh?: () => void;
}

interface UseWebSocketResult {
  isConnected: boolean;
  isReconnecting: boolean;
}

export function useWebSocket({
  projectKey,
  events,
  onReconnectRefresh,
}: UseWebSocketOptions): UseWebSocketResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventsRef = useRef(events);
  const onReconnectRefreshRef = useRef(onReconnectRefresh);
  const hasConnectedOnceRef = useRef(false);

  // Keep refs in sync
  eventsRef.current = events;
  onReconnectRefreshRef.current = onReconnectRefresh;

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!projectKey) return;

    const socket = acquireSocket();

    function handleConnect() {
      setIsConnected(true);
      setIsReconnecting(false);
      stopPolling();
      socket.emit('join-project', projectKey);
      // Full refresh on reconnect (not first connect) to sync state
      if (hasConnectedOnceRef.current) {
        onReconnectRefreshRef.current?.();
      }
      hasConnectedOnceRef.current = true;
    }

    function handleDisconnect() {
      setIsConnected(false);
      setIsReconnecting(true);
      stopPolling();
      pollIntervalRef.current = setInterval(() => {
        onReconnectRefreshRef.current?.();
      }, 5000);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Register event handlers — keep references so we can remove only ours
    const registeredHandlers: Array<[string, (...args: unknown[]) => void]> = [];
    if (eventsRef.current) {
      for (const [event, handler] of Object.entries(eventsRef.current)) {
        const wrapped = handler as (...args: unknown[]) => void;
        socket.on(event, wrapped);
        registeredHandlers.push([event, wrapped]);
      }
    }

    if (!socket.connected) {
      socket.connect();
    } else {
      // Already connected (another consumer brought it up). Join immediately.
      handleConnect();
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);

      for (const [event, handler] of registeredHandlers) {
        socket.off(event, handler);
      }

      // Send leave-project synchronously while transport is still open,
      // then release. The release may or may not disconnect, depending on refcount.
      if (socket.connected) {
        socket.emit('leave-project', projectKey);
      }
      stopPolling();
      releaseSocket();
      setIsConnected(false);
      setIsReconnecting(false);
    };
  }, [projectKey, stopPolling]);

  return { isConnected, isReconnecting };
}
