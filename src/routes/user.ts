import express, { Request, Response } from "express"
import User from "../models/User"
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
