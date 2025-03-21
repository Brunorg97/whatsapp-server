/**
 * WhatsApp Web Service
 * This service manages the connection to WhatsApp Web using the whatsapp-web.js library
 */

import EventEmitter from "events"
import { whatsAppRepository } from "../database/whatsapp-repository"
import type { Message, WhatsAppConnectionState } from "../types/whatsapp"

// Types for the whatsapp-web.js library
interface WhatsAppClient {
  initialize: () => Promise<void>
  destroy: () => Promise<void>
  sendMessage: (to: string, message: string, options?: any) => Promise<any>
  getState: () => "CONNECTED" | "DISCONNECTED" | "CONNECTING"
  on: (event: string, listener: (...args: any[]) => void) => void
  once: (event: string, listener: (...args: any[]) => void) => void
  getChats: () => Promise<any[]>
  getContacts: () => Promise<any[]>
  getContactById: (contactId: string) => Promise<any>
  getChatById: (chatId: string) => Promise<any>
  sendSeen: (chatId: string) => Promise<void>
  getMessages: (chatId: string, options?: any) => Promise<any[]>
}

interface WhatsAppMessage {
  id: { id: string }
  from: string
  to: string
  body: string
  hasMedia: boolean
  timestamp: number
  type: string
  fromMe: boolean
  getChat: () => Promise<any>
  getContact: () => Promise<any>
  getQuotedMessage: () => Promise<any>
  reply: (content: string, chatId?: string) => Promise<any>
  downloadMedia: () => Promise<any>
  getMentions: () => Promise<any[]>
}

interface MessageMedia {
  mimetype: string
  data: string
  filename?: string
}

// Singleton service to manage the WhatsApp client
class WhatsAppService extends EventEmitter {
  private client: WhatsAppClient | null = null
  private qrCode: string | null = null
  private connectionState: "DISCONNECTED" | "CONNECTING" | "CONNECTED" = "DISCONNECTED"
  private connectionError: string | null = null
  private isInitializing = false
  private messageHandlers: Array<(message: WhatsAppMessage) => void> = []
  private sessionPath = "./whatsapp-sessions"
  private puppeteerArgs: string[] = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
  ]

  constructor() {
    super()
  }

  /**
   * Set the path to store sessions
   */
  setSessionPath(path: string): void {
    this.sessionPath = path
  }

  /**
   * Initialize the WhatsApp Web client
   */
  async initialize(): Promise<void> {
    if (this.isInitializing) {
      console.log("Already initializing...")
      return
    }

    if (this.client) {
      console.log("Client already initialized")
      return
    }

    this.isInitializing = true
    this.connectionState = "CONNECTING"
    this.emit("stateChange", this.connectionState)

    try {
      // In a real Node.js environment, you would import these libraries directly
      // For browser preview, we simulate the dynamic import
      console.log("Importing libraries...")

      // Simulate library import
      const { Client, LocalAuth, MessageMedia } = await this.importWhatsAppWeb()

      console.log("Creating WhatsApp client...")
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: this.sessionPath,
          clientId: "whatsapp-web-project", // Unique ID for this instance
        }),
        puppeteer: {
          headless: true,
          args: this.puppeteerArgs,
        },
      }) as WhatsAppClient

      // Set up events
      this.client.on("qr", (qr: string) => {
        console.log("QR Code received")
        this.qrCode = qr
        this.emit("qr", qr)

        // Save QR code to repository
        whatsAppRepository
          .saveQRCode({
            code: qr,
            generatedAt: new Date(),
            expiresAt: new Date(Date.now() + 60 * 1000), // Expires in 60 seconds
          })
          .catch((err) => console.error("Error saving QR code:", err))
      })

      this.client.on("ready", async () => {
        console.log("WhatsApp Web connected successfully!")
        this.connectionState = "CONNECTED"
        this.qrCode = null
        this.connectionError = null
        this.emit("stateChange", this.connectionState)
        this.emit("ready")

        // Register status in repository
        await whatsAppRepository.saveAPIStatus({
          status: "online",
          lastChecked: new Date(),
          rateLimitRemaining: 1000,
          rateLimitReset: new Date(Date.now() + 24 * 60 * 60 * 1000),
          responseTimeMs: 0,
        })

        // Load initial contacts and chats
        await this.loadInitialData()
      })

      this.client.on("authenticated", () => {
        console.log("Authenticated successfully!")
        this.emit("authenticated")

        // Mark QR code as scanned
        if (this.qrCode) {
          whatsAppRepository
            .markQRCodeAsScanned(this.qrCode)
            .catch((err) => console.error("Error marking QR code as scanned:", err))
        }
      })

      this.client.on("auth_failure", (error: any) => {
        console.error("Authentication failure:", error)
        this.connectionError = `Authentication failure: ${error}`
        this.emit("auth_failure", error)
      })

      this.client.on("disconnected", (reason: string) => {
        console.log("WhatsApp Web disconnected:", reason)
        this.connectionState = "DISCONNECTED"
        this.connectionError = reason
        this.emit("stateChange", this.connectionState)
        this.emit("disconnected", reason)

        // Register status in repository
        whatsAppRepository
          .saveAPIStatus({
            status: "offline",
            lastChecked: new Date(),
            rateLimitRemaining: 0,
            rateLimitReset: new Date(Date.now() + 24 * 60 * 60 * 1000),
            responseTimeMs: 0,
            errorMessage: `Disconnected: ${reason}`,
          })
          .catch((err) => console.error("Error saving API status:", err))

        // Clear client
        this.client = null
      })

      this.client.on("message", async (message: WhatsAppMessage) => {
        console.log(`Message received from ${message.from}: ${message.body}`)
        this.emit("message", message)

        // Notify registered handlers
        this.messageHandlers.forEach((handler) => {
          try {
            handler(message)
          } catch (error) {
            console.error("Error in message handler:", error)
          }
        })

        // Process incoming message
        await this.processIncomingMessage(message)
      })

      // Event for message status (read, delivered, etc.)
      this.client.on("message_ack", (message: any, ack: number) => {
        /*
         * Status codes:
         * 0 = PENDING
         * 1 = RECEIVED
         * 2 = RECEIVED BY SERVER
         * 3 = DELIVERED
         * 4 = READ
         * 5 = PLAYED (for audio messages)
         */
        let status = "sent"
        if (ack === 3) status = "delivered"
        if (ack === 4) status = "read"

        console.log(`Message status ${message.id.id}: ${status} (${ack})`)
        this.emit("message_status", { message, status, ack })

        // Update status in repository
        if (message.fromMe) {
          whatsAppRepository
            .updateMessageStatus(message.id.id, status as any, new Date())
            .catch((err) => console.error("Error updating message status:", err))
        }
      })

      console.log("Initializing WhatsApp client...")
      await this.client.initialize()
      console.log("WhatsApp client initialized")
    } catch (error) {
      console.error("Error initializing WhatsApp Web:", error)
      this.connectionState = "DISCONNECTED"
      this.connectionError = error instanceof Error ? error.message : "Unknown error"
      this.emit("stateChange", this.connectionState)
      this.emit("error", this.connectionError)

      // Register error in repository
      whatsAppRepository
        .saveAPIStatus({
          status: "offline",
          lastChecked: new Date(),
          rateLimitRemaining: 0,
          rateLimitReset: new Date(Date.now() + 24 * 60 * 60 * 1000),
          responseTimeMs: 0,
          errorMessage: this.connectionError,
        })
        .catch((err) => console.error("Error saving API status:", err))
    } finally {
      this.isInitializing = false
    }
  }

  /**
   * Load initial contacts and chats
   */
  private async loadInitialData(): Promise<void> {
    if (!this.client || this.connectionState !== "CONNECTED") {
      return
    }

    try {
      console.log("Loading initial contacts and chats...")

      // Load chats
      const chats = await this.client.getChats()
      console.log(`${chats.length} chats found`)

      for (const chat of chats) {
        if (!chat.isGroup) {
          const contact = {
            id: chat.id._serialized,
            name: chat.name || chat.contact.pushname || chat.id.user,
            number: chat.id.user,
            unreadCount: chat.unreadCount || 0,
          }

          if (chat.lastMessage) {
            contact.lastMessage = {
              content: chat.lastMessage.body,
              timestamp: new Date(chat.lastMessage.timestamp * 1000),
              status: chat.lastMessage.fromMe ? "sent" : "received",
            }
          }

          await whatsAppRepository.saveContact(contact)

          // Load recent messages
          try {
            const messages = await this.client.getMessages(chat.id._serialized, { limit: 50 })
            for (const msg of messages) {
              await whatsAppRepository.saveMessage({
                id: msg.id.id,
                chatId: chat.id._serialized,
                content: msg.body,
                timestamp: new Date(msg.timestamp * 1000),
                fromMe: msg.fromMe,
                status: msg.fromMe ? "sent" : "received",
                type: msg.hasMedia ? "media" : "text",
              })
            }
          } catch (err) {
            console.error(`Error loading messages for ${chat.id._serialized}:`, err)
          }
        }
      }

      console.log("Initial contacts and chats loaded successfully")
    } catch (error) {
      console.error("Error loading initial data:", error)
    }
  }

  /**
   * Process an incoming message
   */
  private async processIncomingMessage(message: WhatsAppMessage): Promise<void> {
    try {
      const chatId = message.fromMe ? message.to : message.from
      const formattedChatId = chatId.endsWith("@c.us") ? chatId : `${chatId}@c.us`

      // Get contact information
      let contact = await whatsAppRepository.getContactById(formattedChatId)

      if (!contact) {
        // If contact doesn't exist, create a new one
        const chat = await message.getChat()
        const contactInfo = await message.getContact()

        contact = {
          id: formattedChatId,
          name: contactInfo.name || contactInfo.pushname || chat.name || formattedChatId.split("@")[0],
          number: formattedChatId.split("@")[0],
          unreadCount: message.fromMe ? 0 : 1,
        }

        await whatsAppRepository.saveContact(contact)
      } else if (!message.fromMe) {
        // Increment unread message counter
        contact.unreadCount = (contact.unreadCount || 0) + 1
        await whatsAppRepository.saveContact(contact)
      }

      // Save the message
      await whatsAppRepository.saveMessage({
        id: message.id.id,
        chatId: formattedChatId,
        content: message.body,
        timestamp: new Date(message.timestamp * 1000),
        fromMe: message.fromMe,
        sender: message.fromMe ? "me" : contact.name,
        status: message.fromMe ? "sent" : "received",
        type: message.hasMedia ? "media" : "text",
      })

      // Update contact's last message
      await whatsAppRepository.saveContact({
        ...contact,
        lastMessage: {
          content: message.body,
          timestamp: new Date(message.timestamp * 1000),
          status: message.fromMe ? "sent" : "received",
        },
      })

      // Register message in log
      await whatsAppRepository.saveMessageLog({
        messageId: message.id.id,
        from: message.fromMe ? "me" : message.from.replace("@c.us", ""),
        to: message.fromMe ? message.to.replace("@c.us", "") : "me",
        type: message.hasMedia ? "media" : "text",
        content: message.body,
        status: message.fromMe ? "sent" : "received",
        sentAt: new Date(message.timestamp * 1000),
      })
    } catch (error) {
      console.error("Error processing incoming message:", error)
    }
  }

  /**
   * Disconnect the WhatsApp Web client
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      console.log("Client is not connected")
      return
    }

    try {
      console.log("Disconnecting WhatsApp client...")
      await this.client.destroy()
      this.client = null
      this.qrCode = null
      this.connectionState = "DISCONNECTED"
      this.emit("stateChange", this.connectionState)
      console.log("WhatsApp client disconnected")
    } catch (error) {
      console.error("Error disconnecting WhatsApp Web:", error)
      throw error
    }
  }

  /**
   * Send a text message
   */
  async sendMessage(to: string, message: string, options?: any): Promise<Message> {
    if (!this.client || this.connectionState !== "CONNECTED") {
      throw new Error("WhatsApp client is not connected")
    }

    try {
      // Format number to WhatsApp format
      const formattedNumber = to.includes("@c.us") ? to : `${to}@c.us`

      console.log(`Sending message to ${formattedNumber}: ${message}`)
      const result = await this.client.sendMessage(formattedNumber, message, options)

      // Create message object
      const newMessage: Message = {
        id: result.id.id,
        chatId: formattedNumber,
        content: message,
        timestamp: new Date(),
        fromMe: true,
        sender: "me",
        status: "sent",
        type: "text",
      }

      // Save message to repository
      await whatsAppRepository.saveMessage(newMessage)

      // Register message in log
      await whatsAppRepository.saveMessageLog({
        messageId: result.id.id,
        from: "me",
        to: formattedNumber.replace("@c.us", ""),
        type: "text",
        content: message,
        status: "sent",
        sentAt: new Date(),
      })

      return newMessage
    } catch (error) {
      console.error("Error sending message:", error)
      throw error
    }
  }

  /**
   * Mark a chat as read
   */
  async markChatAsRead(chatId: string): Promise<void> {
    if (!this.client || this.connectionState !== "CONNECTED") {
      throw new Error("WhatsApp client is not connected")
    }

    try {
      const formattedChatId = chatId.includes("@c.us") ? chatId : `${chatId}@c.us`
      await this.client.sendSeen(formattedChatId)
      await whatsAppRepository.markMessagesAsRead(formattedChatId)
    } catch (error) {
      console.error("Error marking chat as read:", error)
      throw error
    }
  }

  /**
   * Get the current connection state
   */
  getConnectionState(): WhatsAppConnectionState {
    return {
      state: this.connectionState,
      error: this.connectionError,
      qrCode: this.qrCode,
    }
  }

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler: (message: WhatsAppMessage) => void): void {
    this.messageHandlers.push(handler)
  }

  /**
   * Remove a message handler
   */
  removeMessageHandler(handler: (message: WhatsAppMessage) => void): void {
    const index = this.messageHandlers.indexOf(handler)
    if (index !== -1) {
      this.messageHandlers.splice(index, 1)
    }
  }

  /**
   * Get the list of chats
   */
  async getChats(): Promise<any[]> {
    if (!this.client || this.connectionState !== "CONNECTED") {
      throw new Error("WhatsApp client is not connected")
    }

    try {
      return await this.client.getChats()
    } catch (error) {
      console.error("Error getting chats:", error)
      throw error
    }
  }

  /**
   * Get the list of contacts
   */
  async getContacts(): Promise<any[]> {
    if (!this.client || this.connectionState !== "CONNECTED") {
      throw new Error("WhatsApp client is not connected")
    }

    try {
      return await this.client.getContacts()
    } catch (error) {
      console.error("Error getting contacts:", error)
      throw error
    }
  }

  /**
   * Import the whatsapp-web.js library
   * In a real Node.js environment, you would import directly
   * For browser preview, we simulate the import
   */
  private async importWhatsAppWeb(): Promise<any> {
    // Simulation of the library
    return {
      Client: class MockClient {
        private eventHandlers: Record<string, Array<(...args: any[]) => void>> = {}
        private onceHandlers: Record<string, Array<(...args: any[]) => void>> = {}
        private state: "CONNECTED" | "DISCONNECTED" | "CONNECTING" = "DISCONNECTED"
        private options: any
        private mockChats: any[] = []
        private mockContacts: any[] = []
        private mockMessages: Record<string, any[]> = {}

        constructor(options: any) {
          console.log("Mock Client created with options:", options)
          this.options = options

          // Create sample data
          this.createMockData()
        }

        private createMockData() {
          // Sample contacts
          this.mockContacts = [
            {
              id: { user: "5511999999991", _serialized: "5511999999991@c.us" },
              name: "João Silva",
              number: "5511999999991",
              pushname: "João",
              isGroup: false,
              isWAContact: true,
              isMyContact: true,
            },
            {
              id: { user: "5511999999992", _serialized: "5511999999992@c.us" },
              name: "Maria Oliveira",
              number: "5511999999992",
              pushname: "Maria",
              isGroup: false,
              isWAContact: true,
              isMyContact: true,
            },
            {
              id: { user: "5511999999993", _serialized: "5511999999993@c.us" },
              name: "Pedro Santos",
              number: "5511999999993",
              pushname: "Pedro",
              isGroup: false,
              isWAContact: true,
              isMyContact: true,
            },
          ]

          // Sample chats
          this.mockChats = this.mockContacts.map((contact) => ({
            id: contact.id,
            name: contact.name,
            isGroup: false,
            unreadCount: Math.floor(Math.random() * 5),
            timestamp: Date.now() - Math.floor(Math.random() * 86400000),
            lastMessage: {
              body: `Last message from ${contact.name}`,
              fromMe: Math.random() > 0.5,
              timestamp: Date.now() - Math.floor(Math.random() * 86400000),
            },
            contact: contact,
          }))

          // Sample messages
          this.mockContacts.forEach((contact) => {
            const chatId = contact.id._serialized
            this.mockMessages[chatId] = []

            // Generate between 10 and 30 messages
            const messageCount = 10 + Math.floor(Math.random() * 20)

            for (let i = 0; i < messageCount; i++) {
              const fromMe = Math.random() > 0.4
              const timestamp = Date.now() - Math.floor(Math.random() * 86400000 * 7) // Up to 7 days ago

              this.mockMessages[chatId].push({
                id: { id: `mock-msg-${chatId}-${i}` },
                body: fromMe ? `Sent message ${i}` : `Received message ${i} from ${contact.name}`,
                from: fromMe ? "me" : chatId,
                to: fromMe ? chatId : "me",
                fromMe: fromMe,
                timestamp: Math.floor(timestamp / 1000),
                hasMedia: false,
                type: "chat",
                getChat: async () => this.mockChats.find((c) => c.id._serialized === chatId),
                getContact: async () => contact,
                getQuotedMessage: async () => null,
                reply: async (content: string) => ({
                  id: { id: `mock-reply-${Date.now()}` },
                  body: content,
                }),
                downloadMedia: async () => null,
              })
            }

            // Sort messages by timestamp
            this.mockMessages[chatId].sort((a, b) => a.timestamp - b.timestamp)
          })
        }

        async initialize(): Promise<void> {
          console.log("Mock: initialize")
          this.state = "CONNECTING"

          // Simulate QR code generation after 2 seconds
          setTimeout(() => {
            this.emit("qr", "mock-qr-code-12345")

            // Simulate successful connection after 3 more seconds
            setTimeout(() => {
              this.state = "CONNECTED"
              this.emit("authenticated")
              this.emit("ready")
            }, 3000)
          }, 2000)
        }

        async destroy(): Promise<void> {
          console.log("Mock: destroy")
          this.state = "DISCONNECTED"
          this.emit("disconnected", "Disconnected by user")
        }

        async sendMessage(to: string, message: string, options?: any): Promise<any> {
          console.log(`Mock: sendMessage to ${to}: ${message}`, options)

          const messageId = `mock-sent-${Date.now()}`
          const timestamp = Math.floor(Date.now() / 1000)

          // Add message to history
          if (!this.mockMessages[to]) {
            this.mockMessages[to] = []
          }

          const newMessage = {
            id: { id: messageId },
            body: message,
            from: "me",
            to: to,
            fromMe: true,
            timestamp: timestamp,
            hasMedia: false,
            type: "chat",
            getChat: async () => this.mockChats.find((c) => c.id._serialized === to),
            getContact: async () => this.mockContacts.find((c) => c.id._serialized === to),
            getQuotedMessage: async () => null,
            reply: async (content: string) => ({
              id: { id: `mock-reply-${Date.now()}` },
              body: content,
            }),
            downloadMedia: async () => null,
          }

          this.mockMessages[to].push(newMessage)

          // Update last chat
          const chat = this.mockChats.find((c) => c.id._serialized === to)
          if (chat) {
            chat.lastMessage = {
              body: message,
              fromMe: true,
              timestamp: timestamp,
            }
          }

          // Simulate message event
          setTimeout(() => {
            this.emit("message", newMessage)

            // Simulate delivery status
            setTimeout(() => {
              this.emit("message_ack", newMessage, 3) // Delivered

              // Simulate read status
              setTimeout(() => {
                this.emit("message_ack", newMessage, 4) // Read
              }, 5000)
            }, 2000)
          }, 500)

          return { id: { id: messageId } }
        }

        getState(): "CONNECTED" | "DISCONNECTED" | "CONNECTING" {
          return this.state
        }

        on(event: string, listener: (...args: any[]) => void): void {
          if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = []
          }
          this.eventHandlers[event].push(listener)
        }

        once(event: string, listener: (...args: any[]) => void): void {
          if (!this.onceHandlers[event]) {
            this.onceHandlers[event] = []
          }
          this.onceHandlers[event].push(listener)
        }

        emit(event: string, ...args: any[]): void {
          // Execute regular handlers
          const handlers = this.eventHandlers[event] || []
          handlers.forEach((handler) => handler(...args))

          // Execute once handlers and remove them
          const onceHandlers = this.onceHandlers[event] || []
          if (onceHandlers.length > 0) {
            onceHandlers.forEach((handler) => handler(...args))
            this.onceHandlers[event] = []
          }
        }

        async getChats(): Promise<any[]> {
          return this.mockChats
        }

        async getContacts(): Promise<any[]> {
          return this.mockContacts
        }

        async getContactById(contactId: string): Promise<any> {
          return this.mockContacts.find((c) => c.id._serialized === contactId)
        }

        async getChatById(chatId: string): Promise<any> {
          return this.mockChats.find((c) => c.id._serialized === chatId)
        }

        async sendSeen(chatId: string): Promise<void> {
          console.log(`Mock: sendSeen to ${chatId}`)
        }

        async getMessages(chatId: string, options?: any): Promise<any[]> {
          const limit = options?.limit || 50
          const messages = this.mockMessages[chatId] || []
          return messages.slice(-limit)
        }
      },
      LocalAuth: class MockLocalAuth {
        constructor(options: any) {
          console.log("Mock LocalAuth created with options:", options)
        }
      },
      MessageMedia: class MockMessageMedia {
        mimetype: string
        data: string
        filename?: string

        constructor(mimetype: string, data: string, filename?: string) {
          this.mimetype = mimetype
          this.data = data
          this.filename = filename
        }

        static fromFilePath(filePath: string): MockMessageMedia {
          console.log(`Mock: MessageMedia.fromFilePath(${filePath})`)
          return new MockMessageMedia("image/png", "base64data", "mock-file.png")
        }

        static async fromUrl(url: string): Promise<MockMessageMedia> {
          console.log(`Mock: MessageMedia.fromUrl(${url})`)
          return new MockMessageMedia("image/png", "base64data", "mock-file.png")
        }
      },
    }
  }
}

// Export a singleton instance
export const whatsAppService = new WhatsAppService()

