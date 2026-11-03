export type CallType = 'audio' | 'video'

export type MessageType = 'text' | 'call'

export interface ChatMessage {
  id: string
  from: string
  to: string
  type: MessageType
  text: string
  createdAt: number
  readAt?: number | null
  /** optimistic-only fields */
  pending?: boolean
  clientId?: string
}

export interface CallMeta {
  kind: 'ended' | 'missed' | 'rejected' | 'cancelled'
  callType: CallType
  duration: number
}

/** account identity — username is the unique handle, displayName is the shown name */
export interface AuthUser {
  username: string
  displayName: string
}

/** a known account (chat partner or search result) */
export interface ChatUser extends AuthUser {
  online: boolean
  lastSeen: number
}

export type CallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'

export interface CallInfo {
  callId: string
  peer: string
  peerName?: string
  type: CallType
  direction: 'out' | 'in'
}
