import express, { Request, Response } from "express"
import User from "../models/User"
import Transaction from "../models/Transaction"
import authMiddleware from "../middleware/authMiddleware"

type AuthRequest = Request & { user?: { id?: string } }

const router = express.Router()

// ------------------------
// GET LOGGED-IN USER DATA
// ------------------------
router.get("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!.id).select("-password -otp")

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" })
    }

    res.json({ success: true, user })
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ------------------------
// GET MY PAYMENTS (Dashboard)
// ------------------------
router.get("/payments", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Debug Auth to fix empty dashboard
    const userObj = (req as any).user
    // Check both locations where middleware might put ID
    const userId = userObj?.id || (req as any).userId

    console.log("[User Payments] Debug:", {
      reqUser: userObj,
      reqUserId: (req as any).userId,
      extractedId: userId
    })

    if (!userId) {
      console.error("[User Payments] No User ID found in request")
      return res.status(401).json({ success: false, message: "Unauthorized: No User ID" })
    }

    // Fetch transactions for this user, sorted by newest first
    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .lean()

    console.log(`[User Payments] Found ${transactions.length} transactions for user ${userId}`)

    res.json({
      success: true,
      data: transactions.map((t: any) => ({
        id: t._id,
        orderId: t.orderId,
        paymentId: t.paymentId,
        amount: t.amount,
        currency: t.currency,
        status: t.status, // pending, completed, failed
        date: t.createdAt,
        method: t.paymentMethod || "UPI",
        description: t.description || "Order Payment"
      }))
    })
  } catch (error: any) {
    console.error("[User Payments] Error fetching history:", error)
    res.status(500).json({ success: false, message: "Failed to fetch payments" })
  }
})

// ------------------------
// UPDATE ACCOUNT DETAILS
// ------------------------
router.put("/update", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const fields = [
      "businessName",
      "phone",
      "address",
      "city",
      "state",
      "pincode",
      "company",
      "name",
    ]

    const updateData: any = {}

    fields.forEach((key) => {
      if (req.body[key] !== undefined) updateData[key] = req.body[key]
    })

    const user = await User.findByIdAndUpdate(req.user!.id, updateData, {
      new: true,
    }).select("-password -otp")

    res.json({ success: true, user })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

export default router
