import type { Contact, Message, MessageLog, QRCode, APIStatus } from "../types/whatsapp"

// In-memory storage for development
// In production, you would replace this with a real database
class WhatsAppRepository {
  private contacts: Record<string, Contact> = {}
  private messages: Record<string, Message[]> = {}
  private messageLogs: MessageLog[] = []
  private qrCodes: QRCode[] = []
  private apiStatus: APIStatus | null = null

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

  // Messages
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

  async updateMessageStatus(messageId: string, status: "sent" | "delivered" | "read", timestamp: Date): Promise<void> {
    // Find message in all chats
    for (const chatId in this.messages) {
      const messageIndex = this.messages[chatId].findIndex((m) => m.id === messageId)
      if (messageIndex >= 0) {
        this.messages[chatId][messageIndex].status = status

        // Update message log
        const logIndex = this.messageLogs.findIndex((log) => log.messageId === messageId)
        if (logIndex >= 0) {
          this.messageLogs[logIndex].status = status

          if (status === "delivered") {
            this.messageLogs[logIndex].deliveredAt = timestamp
          } else if (status === "read") {
            this.messageLogs[logIndex].readAt = timestamp
          }
        }

        break
      }
    }
  }

  async markMessagesAsRead(chatId: string): Promise<void> {
    if (this.messages[chatId]) {
      this.messages[chatId] = this.messages[chatId].map((message) => {
        if (!message.fromMe && message.status !== "read") {
          return { ...message, status: "read" }
        }
        return message
      })

      // Update contact unread count
      if (this.contacts[chatId]) {
        this.contacts[chatId].unreadCount = 0
      }
    }
  }

  // Message Logs
  async saveMessageLog(log: MessageLog): Promise<MessageLog> {
    this.messageLogs.push(log)
    return log
  }

  async getMessageLogs(): Promise<MessageLog[]> {
    return this.messageLogs
  }

  // QR Codes
  async saveQRCode(qrCode: QRCode): Promise<QRCode> {
    this.qrCodes.push(qrCode)
    return qrCode
  }

  async getLatestQRCode(): Promise<QRCode | null> {
    if (this.qrCodes.length === 0) return null

    // Sort by generation time and get the latest
    return this.qrCodes.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())[0]
  }

  async markQRCodeAsScanned(code: string): Promise<void> {
    const qrCode = this.qrCodes.find((qr) => qr.code === code)
    if (qrCode) {
      qrCode.scanned = true
      qrCode.scannedAt = new Date()
    }
  }

  // API Status
  async saveAPIStatus(status: APIStatus): Promise<APIStatus> {
    this.apiStatus = status
    return status
  }

  async getAPIStatus(): Promise<APIStatus | null> {
    return this.apiStatus
  }
}

// Export a singleton instance
export const whatsAppRepository = new WhatsAppRepository()

