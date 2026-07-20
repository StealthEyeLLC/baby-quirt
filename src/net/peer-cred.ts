/** Unix socket peer credential lookup via Node-API native SO_PEERCRED. */

import { createRequire } from 'node:module';
import type { Socket } from 'node:net';

const require = createRequire(import.meta.url);

interface PeerCredNative {
  getPeerCred(fd: number): { ok: boolean; uid?: number; gid?: number; pid?: number };
}

let native: PeerCredNative | undefined;

function loadNative(): PeerCredNative {
  if (native) return native;
  try {
    native = require('../../build/Release/peer_cred.node') as PeerCredNative;
  } catch {
    native = require('../../build/Debug/peer_cred.node') as PeerCredNative;
  }
  return native!;
}

function getSocketFd(socket: Socket): number | undefined {
  const handle = (socket as unknown as { _handle?: { fd?: number } })._handle;
  if (handle && typeof handle.fd === 'number') {
    return handle.fd;
  }
  return undefined;
}

export function getSocketPeerCred(
  socket: Socket,
): { uid: number; gid: number; pid: number } | undefined {
  const fd = getSocketFd(socket);
  if (fd === undefined) return undefined;
  try {
    const cred = loadNative().getPeerCred(fd);
    if (!cred.ok || cred.uid === undefined || cred.gid === undefined || cred.pid === undefined) {
      return undefined;
    }
    return { uid: cred.uid, gid: cred.gid, pid: cred.pid };
  } catch {
    return undefined;
  }
}

export function getSocketPeerUid(socket: Socket): number | undefined {
  return getSocketPeerCred(socket)?.uid;
}

export function getSocketPeerGid(socket: Socket): number | undefined {
  return getSocketPeerCred(socket)?.gid;
}
