import express, { Request, Response } from "express"
import authMiddleware from "../middleware/authMiddleware"
import isAdmin from "../middleware/isAdmin"
import User from "../models/User"
import Transaction from "../models/Transaction"

const router = express.Router()

// GET all users (admin only)
router.get("/users", authMiddleware, isAdmin, async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "50", q = "" } = req.query as any
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const lim = Math.max(1, parseInt(limit, 10) || 50)

    const filter: any = {}
    if (q) {
      filter.$or = [
        { email: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } },
      ]
    }

    const total = await User.countDocuments(filter)
    const users = await User.find(filter)
      .select("-password -otp")
      .skip((pageNum - 1) * lim)
      .limit(lim)
      .lean()

    res.json({ success: true, data: { users, total, page: pageNum, limit: lim } })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET transactions (admin only)
router.get("/transactions", authMiddleware, isAdmin, async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "50", q = "", status = "", type = "", dateFrom, dateTo } = req.query as any
    const pageNum = Math.max(1, parseInt(page, 10) || 1)
    const lim = Math.max(1, parseInt(limit, 10) || 50)

    const filter: any = {}
    if (q) {
      filter.$or = [
        { "customer.email": { $regex: q, $options: "i" } },
        { "customer.name": { $regex: q, $options: "i" } },
        { orderId: { $regex: q, $options: "i" } },
        { paymentId: { $regex: q, $options: "i" } },
      ]
    }

    if (status) filter.status = status
    if (type) filter.type = type

    if (dateFrom || dateTo) {
      filter.createdAt = {}
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom)
      if (dateTo) filter.createdAt.$lte = new Date(dateTo)
    }

    const total = await Transaction.countDocuments(filter)
    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * lim)
      .limit(lim)
      .lean()

    res.json({ success: true, data: { transactions, total, page: pageNum, limit: lim } })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// GET transaction detail
router.get("/transactions/:id", authMiddleware, isAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const tx = await Transaction.findById(id).lean()
    if (!tx) return res.status(404).json({ success: false, message: "Transaction not found" })
    res.json({ success: true, data: tx })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// Export transactions CSV
router.get("/transactions-export", authMiddleware, isAdmin, async (req: Request, res: Response) => {
  try {
    const { q = "", status = "", type = "", dateFrom, dateTo } = req.query as any
    const filter: any = {}
    if (q) {
      filter.$or = [
        { "customer.email": { $regex: q, $options: "i" } },
        { "customer.name": { $regex: q, $options: "i" } },
        { orderId: { $regex: q, $options: "i" } },
        { paymentId: { $regex: q, $options: "i" } },
      ]
    }
    if (status) filter.status = status
    if (type) filter.type = type
    if (dateFrom || dateTo) {
      filter.createdAt = {}
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom)
      if (dateTo) filter.createdAt.$lte = new Date(dateTo)
    }

    const txns = await Transaction.find(filter).sort({ createdAt: -1 }).lean()

    // Build CSV
    const header = ["orderId", "paymentId", "amount", "currency", "status", "customerName", "customerEmail", "createdAt"]
    const rows = txns.map((t: any) => [t.orderId, t.paymentId, t.amount, t.currency, t.status, t.customer?.name || "", t.customer?.email || "", t.createdAt?.toISOString() || ""]) 

    const csv = [header.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n")

    res.setHeader("Content-Type", "text/csv")
    res.setHeader("Content-Disposition", `attachment; filename="transactions_${Date.now()}.csv"`)
    res.send(csv)
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// Overview metrics
router.get("/overview", authMiddleware, isAdmin, async (req: Request, res: Response) => {
  try {
    // Simple totals and last 7 days series
    const totalVolumeAgg = await Transaction.aggregate([
      { $match: {} },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ])

    const total = totalVolumeAgg[0] || { total: 0, count: 0 }

    const successCount = await Transaction.countDocuments({ status: "completed" })
    const failedCount = await Transaction.countDocuments({ status: "failed" })

    // last 7 days series
    const days = 7
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - (days - 1))

    const series = await Transaction.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])

    res.json({
      success: true,
      data: {
        totalVolume: total.total || 0,
        totalCount: total.count || 0,
        successCount,
        failedCount,
        series,
      },
    })
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// PATCH update user flags (e.g., isAdmin) - admin only
router.patch("/users/:id", authMiddleware, isAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    // Validate user ID format
    if (!id || id.length < 24) {
      return res.status(400).json({ success: false, message: "Invalid user ID format" })
    }

    // Parse and validate request body - handle both string and boolean values
    let { isAdmin: makeAdmin, isVerified: verifyUser } = req.body as { isAdmin?: boolean | string; isVerified?: boolean | string }

    // Convert string "true"/"false" to boolean if needed
    if (typeof makeAdmin === "string") {
      makeAdmin = makeAdmin === "true" || makeAdmin === "1"
    }
    if (typeof verifyUser === "string") {
      verifyUser = verifyUser === "true" || verifyUser === "1"
    }

    const updateFields: any = {}
    if (typeof makeAdmin !== "undefined" && makeAdmin !== null) {
      updateFields.isAdmin = Boolean(makeAdmin)
    }
    if (typeof verifyUser !== "undefined" && verifyUser !== null) {
      const isVerifiedValue = Boolean(verifyUser)
      updateFields.isVerified = isVerifiedValue
      // Also sync the 'verified' field for consistency
      updateFields.verified = isVerifiedValue
      // Set verifiedAt timestamp when verifying
      if (isVerifiedValue) {
        updateFields.verifiedAt = new Date()
      } else {
        updateFields.verifiedAt = null
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "At least one field (isAdmin or isVerified) is required in body. Both fields must be boolean values (true/false)." 
      })
    }

    // Use findOneAndUpdate with runValidators to ensure proper persistence
    const user = await User.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select("-password -otp")

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" })
    }

    res.json({ success: true, data: user })
  } catch (error: any) {
    console.error("Error updating user:", error)
    res.status(500).json({ success: false, message: error.message || "Failed to update user" })
  }
})

export default router
