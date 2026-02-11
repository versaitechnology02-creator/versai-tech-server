import express, { Request, Response } from "express"
import Payout from "../models/Payout"
import User from "../models/User"
import authMiddleware from "../middleware/authMiddleware"

const router = express.Router()

// Middleware to check if user is admin
const adminMiddleware = async (req: Request, res: Response, next: Function) => {
    try {
        const user = await User.findById((req as any).user.id)
        if (user && user.isAdmin) {
            next()
        } else {
            res.status(403).json({ success: false, message: "Access denied. Admin only." })
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" })
    }
}

// @route   GET /api/admin/payouts
// @desc    Get all payouts (with filters)
// @access  Admin
router.get("/", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
        const { status, userId } = req.query
        const query: any = {}
        if (status) query.status = status
        if (userId) query.userId = userId

        const payouts = await Payout.find(query)
            .populate("userId", "name email walletBalance")
            .sort({ createdAt: -1 })

        res.json({ success: true, data: payouts })
    } catch (error: any) {
        res.status(500).json({ success: false, message: "Server error" })
    }
})

// @route   POST /api/admin/payouts/:id/action
// @desc    Approve or Reject payout
// @access  Admin
router.post("/:id/action", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
    try {
        const { action, comment } = req.body // action: 'approve' | 'reject' | 'complete'
        const payoutId = req.params.id

        const payout = await Payout.findById(payoutId)
        if (!payout) {
            return res.status(404).json({ success: false, message: "Payout request not found" })
        }

        if (payout.status !== "pending" && payout.status !== "approved") {
            return res.status(400).json({ success: false, message: `Payout is already ${payout.status}` })
        }

        if (action === "approve") {
            // Mark as Approved (Ready for manual processing or payment gateway trigger)
            payout.status = "approved"
            payout.adminComment = comment || "Approved by admin"
            payout.processedAt = new Date()
            await payout.save()

            // TODO: Here you triggers the actual bank transfer via Gateway if integrated.
            // For MVP, Admin manually transfers and then marks as 'completed'.

        } else if (action === "reject") {
            // Refund the amount to user's wallet
            const user = await User.findById(payout.userId)
            if (user) {
                user.walletBalance += payout.amount
                await user.save()
            }

            payout.status = "rejected"
            payout.adminComment = comment || "Rejected by admin"
            payout.processedAt = new Date()
            await payout.save()

        } else if (action === "complete") {
            // Admin marks as manually done
            payout.status = "completed"
            payout.adminComment = comment || "Marked as completed"
            payout.processedAt = new Date()
            await payout.save()
        } else {
            return res.status(400).json({ success: false, message: "Invalid action" })
        }

        res.json({ success: true, message: `Payout ${action}d successfully`, data: payout })
    } catch (error: any) {
        console.error("Admin payout action error:", error)
        res.status(500).json({ success: false, message: "Server error" })
    }
})

export default router
