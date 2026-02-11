import type { Response } from "express"

/**
 * Server-Sent Events (SSE) Manager
 * Handles real-time one-way connection from Server to Client.
 * Used for instant payment status updates.
 */
class SSEManager {
    private clients: Map<string, Response[]> = new Map()

    /**
     * Add a new client connection for a specific order
     */
    addClient(orderId: string, res: Response) {
        if (!this.clients.has(orderId)) {
            this.clients.set(orderId, [])
        }

        const clientList = this.clients.get(orderId)!
        clientList.push(res)

        console.log(`[SSE] Client connected for order: ${orderId} (Total: ${clientList.length})`)

        // Remove client on connection close
        res.on("close", () => {
            this.removeClient(orderId, res)
        })
    }

    /**
     * Remove a client connection
     */
    removeClient(orderId: string, res: Response) {
        const clientList = this.clients.get(orderId)
        if (!clientList) return

        const index = clientList.indexOf(res)
        if (index !== -1) {
            clientList.splice(index, 1)
            console.log(`[SSE] Client disconnected from order: ${orderId} (Remaining: ${clientList.length})`)
        }

        // Cleanup empty lists to save memory
        if (clientList.length === 0) {
            this.clients.delete(orderId)
        }
    }

    /**
     * Broadcast data to all clients listening to an order
     */
    broadcast(orderId: string, data: any) {
        const clientList = this.clients.get(orderId)
        if (!clientList || clientList.length === 0) {
            console.log(`[SSE] No clients connected for order: ${orderId}. Skipping broadcast.`)
            return
        }

        console.log(`[SSE] Broadcasting to ${clientList.length} clients for order: ${orderId}`, data)

        const payload = `data: ${JSON.stringify(data)}\n\n`

        clientList.forEach((res) => {
            try {
                res.write(payload)
                // Keep connection open, do not res.end() unless it's a terminal state if desired
            } catch (err) {
                console.error(`[SSE] Failed to send to client for order ${orderId}:`, err)
                this.removeClient(orderId, res)
            }
        })
    }

    /**
     * Send a keep-alive comment to prevent timeouts
     */
    keepAlive(orderId: string) {
        const clientList = this.clients.get(orderId)
        if (clientList) {
            clientList.forEach(res => res.write(": keep-alive\n\n"))
        }
    }
}

export const sseManager = new SSEManager()
