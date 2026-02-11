import express, { Request, Response } from "express"
import User from "../models/User"
import Payout from "../models/Payout"
import authMiddleware from "../middleware/authMiddleware"

const router = express.Router()

// @route   POST /api/payouts/request
// @desc    Request a payout
// @access  Private
router.post("/request", authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id
        const { amount, method, details } = req.body

        // Validation
        if (!amount || amount < 1) {
            return res.status(400).json({ success: false, message: "Invalid amount" })
        }
        if (!["bank_transfer", "upi"].includes(method)) {
            return res.status(400).json({ success: false, message: "Invalid payout method" })
        }
        if (!details || (method === "upi" && !details.upiId) || (method === "bank_transfer" && (!details.accountNumber || !details.ifscCode))) {
            return res.status(400).json({ success: false, message: "Missing payment details" })
        }

        // Atomic Balance Check & Deduct
        const user = await User.findOneAndUpdate(
            { _id: userId, walletBalance: { $gte: amount } },
            { $inc: { walletBalance: -amount } },
            { new: true }
        )

        if (!user) {
            return res.status(400).json({ success: false, message: "Insufficient wallet balance" })
        }

        // Create Payout Record
        const payout = await Payout.create({
            userId,
            amount,
            method,
            details,
            status: "pending",
        })

        res.status(201).json({
            success: true,
            message: "Payout requested successfully",
            data: payout,
            newBalance: user.walletBalance,
        })
    } catch (error: any) {
        console.error("Payout request error:", error)
        res.status(500).json({ success: false, message: "Server error" })
    }
})

// @route   GET /api/payouts/history
// @desc    Get user payout history
// @access  Private
router.get("/history", authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id
        const payouts = await Payout.find({ userId }).sort({ createdAt: -1 })

        res.json({ success: true, data: payouts })
    } catch (error: any) {
        res.status(500).json({ success: false, message: "Server error" })
    }
})

export default router
