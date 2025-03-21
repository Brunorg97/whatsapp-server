/**
 * Repositório para armazenar dados relacionados à API do WhatsApp
 */

// Tipos
export interface TokenRecord {
  id: string
  token: string
  phoneNumberId: string
  expiresAt: Date
  isActive: boolean
  createdAt: Date
}

export interface MessageLogRecord {
  messageId: string
  from?: string
  to?: string
  type: string
  content: string
  status: "sent" | "delivered" | "read" | "failed" | "received"
  sentAt: Date
  deliveredAt?: Date
  readAt?: Date
  failedReason?: string
  metadata?: Record<string, any>
}

export interface WebhookRecord {
  id: string
  url: string
  secretKey: string
  eventTypes: string[]
  status: "active" | "inactive" | "error"
  lastUpdated: Date
  createdAt: Date
}

export interface QRCodeRecord {
  id: string
  code: string
  deepLinkUrl: string
  qrImageUrl: string
  prefilledMessage?: string
  createdAt: Date
  expiresAt: Date
  scannedAt?: Date
}

export interface APIStatusRecord {
  id: string
  status: "online" | "degraded" | "offline"
  lastChecked: Date
  rateLimitRemaining: number
  rateLimitReset: Date
  responseTimeMs: number
  errorMessage?: string
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

class WhatsAppAPIRepository {
  private tokens: TokenRecord[] = []
  private messageLogs: MessageLogRecord[] = []
  private webhooks: WebhookRecord[] = []
  private qrCodes: QRCodeRecord[] = []
  private apiStatuses: APIStatusRecord[] = []
  private contacts: Record<string, Contact> = {}
  private messages: Record<string, Message[]> = {}

  // Tokens
  async saveToken(token: Omit<TokenRecord, "id" | "createdAt">): Promise<TokenRecord> {
    const newToken: TokenRecord = {
      id: `token_${Date.now()}`,
      createdAt: new Date(),
      ...token,
    }
    this.tokens.push(newToken)
    return newToken
  }

  async getActiveToken(phoneNumberId: string): Promise<TokenRecord | null> {
    const now = new Date()
    const activeToken = this.tokens.find(
      (token) => token.phoneNumberId === phoneNumberId && token.isActive && token.expiresAt > now,
    )
    return activeToken || null
  }

  async deactivateTokens(phoneNumberId: string): Promise<void> {
    this.tokens.forEach((token) => {
      if (token.phoneNumberId === phoneNumberId) {
        token.isActive = false
      }
    })
  }

  // Contacts
  async saveContact(contact: Contact): Promise<Contact> {
    this.contacts[contact.id] = {
      ...this.contacts[contact.id],
      ...contact,
    }
    return this.contacts[contact.id]
  }

  async getContacts(): Promise<Contact[]> {
    return Object.values(this.contacts)
  }

  async getContactById(id: string): Promise<Contact | null> {
    return this.contacts[id] || null
  }

  // Message Logs
  async saveMessageLog(message: Omit<MessageLogRecord, "sentAt">): Promise<MessageLogRecord> {
    const newMessage: MessageLogRecord = {
      messageId: message.messageId,
      sentAt: new Date(),
      ...message,
    }
    this.messageLogs.push(newMessage)
    return newMessage
  }

  async updateMessageStatus(
    messageId: string,
    status: "sent" | "delivered" | "read" | "failed" | "received",
    timestamp: Date,
    errorMessage?: string,
  ): Promise<boolean> {
    const message = this.messageLogs.find((m) => m.messageId === messageId)
    if (!message) return false

    message.status = status
    if (status === "delivered") message.deliveredAt = timestamp
    if (status === "read") message.readAt = timestamp
    if (status === "failed") message.failedReason = errorMessage

    return true
  }

  async getMessageLogs(filters: {
    status?: string
    type?: string
    to?: string
    startDate?: Date
    endDate?: Date
    limit: number
    offset: number
  }): Promise<{ messages: MessageLogRecord[]; total: number }> {
    let filteredMessages = [...this.messageLogs]

    if (filters.status) {
      filteredMessages = filteredMessages.filter((m) => m.status === filters.status)
    }
    if (filters.type) {
      filteredMessages = filteredMessages.filter((m) => m.type === filters.type)
    }
    if (filters.to) {
      filteredMessages = filteredMessages.filter((m) => m.to === filters.to)
    }
    if (filters.startDate) {
      filteredMessages = filteredMessages.filter((m) => m.sentAt >= filters.startDate!)
    }
    if (filters.endDate) {
      filteredMessages = filteredMessages.filter((m) => m.sentAt <= filters.endDate!)
    }

    const total = filteredMessages.length
    const messages = filteredMessages.slice(filters.offset, filters.offset + filters.limit)

    return { messages, total }
  }

  // Webhooks
  async saveWebhook(webhook: Omit<WebhookRecord, "id" | "createdAt">): Promise<WebhookRecord> {
    const newWebhook: WebhookRecord = {
      id: `webhook_${Date.now()}`,
      createdAt: new Date(),
      ...webhook,
    }
    this.webhooks.push(newWebhook)
    return newWebhook
  }

  async updateWebhookStatus(
    id: string,
    status: "active" | "inactive" | "error",
    errorMessage?: string,
  ): Promise<boolean> {
    const webhook = this.webhooks.find((w) => w.id === id)
    if (!webhook) return false

    webhook.status = status
    return true
  }

  async getWebhooks(): Promise<WebhookRecord[]> {
    return this.webhooks
  }

  async deleteWebhook(id: string): Promise<boolean> {
    const index = this.webhooks.findIndex((w) => w.id === id)
    if (index === -1) return false

    this.webhooks.splice(index, 1)
    return true
  }

  // QR Codes
  async saveQRCode(qrCode: Omit<QRCodeRecord, "id">): Promise<QRCodeRecord> {
    const newQRCode: QRCodeRecord = {
      id: `qrcode_${Date.now()}`,
      ...qrCode,
    }
    this.qrCodes.push(newQRCode)
    return newQRCode
  }

  async recordQRCodeScan(code: string): Promise<boolean> {
    const qrCode = this.qrCodes.find((q) => q.code === code)
    if (!qrCode) return false

    qrCode.scannedAt = new Date()
    return true
  }

  async getQRCodes(limit: number, offset: number): Promise<QRCodeRecord[]> {
    return this.qrCodes.slice(offset, offset + limit)
  }

  // API Status
  async saveAPIStatus(status: Omit<APIStatusRecord, "id">): Promise<APIStatusRecord> {
    const newAPIStatus: APIStatusRecord = {
      id: `apistatus_${Date.now()}`,
      ...status,
    }
    this.apiStatuses.push(newAPIStatus)
    return newAPIStatus
  }

  async getLatestAPIStatus(): Promise<APIStatusRecord | null> {
    if (this.apiStatuses.length === 0) return null
    return this.apiStatuses[this.apiStatuses.length - 1]
  }

  async getAPIStatusHistory(days: number): Promise<APIStatusRecord[]> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    return this.apiStatuses.filter((s) => s.lastChecked >= cutoff)
  }

  async saveMessage(message: Message): Promise<Message> {
    if (!this.messages[message.chatId]) {
      this.messages[message.chatId] = []
    }

    // Check if message already exists
    const existingIndex = this.messages[message.chatId].findIndex((m) => m.id === message.id)

    if (existingIndex >= 0) {
      // Update existing message
      this.messages[message.chatId][existingIndex] = {
        ...this.messages[message.chatId][existingIndex],
        ...message,
      }
    } else {
      // Add new message
      this.messages[message.chatId].push(message)
    }

    return message
  }

  async getMessages(chatId: string): Promise<Message[]> {
    return this.messages[chatId] || []
  }

  async markMessagesAsRead(chatId: string): Promise<void> {
    if (this.messages[chatId]) {
      this.messages[chatId] = this.messages[chatId].map((message) => {
        if (!message.fromMe && message.status !== "read") {
          return { ...message, status: "read" }
        }
        return message
      })
    }
  }
}

export const whatsAppAPIRepository = new WhatsAppAPIRepository()

