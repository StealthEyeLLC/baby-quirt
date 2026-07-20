/** Unix socket peer credential lookup (Linux SO_PEERCRED). */

import type { Socket } from 'node:net';

interface PipeHandle {
  getPeerUID?: () => number;
  getPeerGID?: () => number;
  fd?: number;
}

export function getSocketPeerUid(socket: Socket): number | undefined {
  const handle = (socket as unknown as { _handle?: PipeHandle })._handle;
  if (handle && typeof handle.getPeerUID === 'function') {
    try {
      return handle.getPeerUID();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function getSocketPeerGid(socket: Socket): number | undefined {
  const handle = (socket as unknown as { _handle?: PipeHandle })._handle;
  if (handle && typeof handle.getPeerGID === 'function') {
    try {
      return handle.getPeerGID();
    } catch {
      return undefined;
    }
  }
  return undefined;
}
