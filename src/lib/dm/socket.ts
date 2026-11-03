'use client'

import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket || socket.disconnected) {
    socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    })
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __dmSocket?: Socket }).__dmSocket = socket
    }
  }
  return socket
}
