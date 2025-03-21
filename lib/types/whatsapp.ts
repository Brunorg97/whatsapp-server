export interface WhatsAppConnectionState {
  state: "DISCONNECTED" | "CONNECTING" | "CONNECTED"
  qrCode: string | null
  error: string | null
}

export interface Contact {
  id: string
  name: string
  number: string
  profilePicture?: string
  lastMessage?: {
    content: string
    timestamp: Date
    status: "sent" | "delivered" | "read" | "received"
  }
  unreadCount?: number
}

export interface Message {
  id: string
  chatId: string
  content: string
  timestamp: Date
  fromMe: boolean
  sender?: string
  status: "sent" | "delivered" | "read" | "received"
  type: "text" | "media" | "document" | "location"
  mediaUrl?: string
}

export interface MessageLog {
  messageId: string
  from: string
  to: string
  type: string
  content: string
  status: "sent" | "delivered" | "read" | "received"
  sentAt: Date
  deliveredAt?: Date
  readAt?: Date
}

export interface QRCode {
  code: string
  generatedAt: Date
  expiresAt: Date
  scanned?: boolean
  scannedAt?: Date
}

export interface APIStatus {
  status: "online" | "offline" | "rate_limited"
  lastChecked: Date
  rateLimitRemaining: number
  rateLimitReset: Date
  responseTimeMs: number
  errorMessage?: string
}

