import { io, type Socket } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:3001';

let socket: Socket | null = null;
let refCount = 0;

function createSocket(): Socket {
  return io(`${API_URL}/board`, {
    withCredentials: true, // sends httpOnly cookies with handshake
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });
}

export function getSocket(): Socket {
  if (!socket) {
    socket = createSocket();
  }
  return socket;
}

// Acquire a reference to the shared socket. Pair with releaseSocket().
export function acquireSocket(): Socket {
  refCount += 1;
  return getSocket();
}

// Release a reference. When the last consumer releases, the socket is
// disconnected and the singleton is cleared.
export function releaseSocket(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && socket) {
    socket.disconnect();
    socket = null;
  }
}
