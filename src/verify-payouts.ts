import mongoose from "mongoose"
import dotenv from "dotenv"
import User from "./models/User"
import Payout from "./models/Payout"
import request from "supertest"
import express from "express"
import payoutRoutes from "./routes/payouts"
import adminPayoutRoutes from "./routes/admin_payouts"
import bodyParser from "body-parser"

dotenv.config()

// Mock App Setup
const app = express()
app.use(bodyParser.json())

// Mock Auth Middleware
const mockAuth = (req: any, res: any, next: any) => {
    req.user = { id: "65c3f9b2e4b0a1a2b3c4d5e6" } // Test User ID
    next()
}
const mockAdminAuth = (req: any, res: any, next: any) => {
    req.user = { id: "65c3f9b2e4b0a1a2b3c4d5e6" }
    next() // Admin check is inside route, we need to mock user as admin in DB
}

app.use("/api/payouts", mockAuth, payoutRoutes)
app.use("/api/admin/payouts", mockAdminAuth, adminPayoutRoutes)

async function runVerification() {
    try {
        if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing")
        await mongoose.connect(process.env.MONGODB_URI)
        console.log("✅ Connected to MongoDB")

        const userId = "65c3f9b2e4b0a1a2b3c4d5e6"

        // 1. Setup Test User
        await User.deleteMany({ _id: userId })
        await Payout.deleteMany({ userId })

        await User.create({
            _id: userId,
            name: "Test User",
            email: "test@example.com",
            walletBalance: 1000,
            isAdmin: true, // Make admin for admin route testing
            verified: true,
            isVerified: true
        })
        console.log("✅ Test User Created (Balance: 1000)")

        // 2. Request Payout (500)
        console.log("👉 Requesting Payout of 500...")
        const reqRes = await request(app)
            .post("/api/payouts/request")
            .send({
                amount: 500,
                method: "bank_transfer",
                details: { accountNumber: "123456", ifscCode: "HDFC000123" }
            })

        if (reqRes.status !== 201) throw new Error(`Request failed: ${reqRes.body.message}`)
        const payoutId = reqRes.body.data._id
        console.log(`✅ Payout Requested: ${payoutId}`)

        // 3. Verify Balance Deduction
        const userAfterReq = await User.findById(userId)
        if (userAfterReq?.walletBalance !== 500) throw new Error(`Balance mismatch! Expected 500, got ${userAfterReq?.walletBalance}`)
        console.log("✅ Balance successfully deducted to 500")

        // 4. Admin Reject Payout
        console.log("👉 Admin Rejecting Payout...")
        const rejectRes = await request(app)
            .post(`/api/admin/payouts/${payoutId}/action`)
            .send({ action: "reject", comment: "Test rejection" })

        if (rejectRes.status !== 200) throw new Error(`Reject failed: ${rejectRes.body.message}`)

        const userAfterReject = await User.findById(userId)
        if (userAfterReject?.walletBalance !== 1000) throw new Error(`Refund failed! Expected 1000, got ${userAfterReject?.walletBalance}`)
        console.log("✅ Payout Rejected & Balance Refunded to 1000")

        // 5. Request Another Payout (200)
        console.log("👉 Requesting Payout of 200...")
        const reqRes2 = await request(app)
            .post("/api/payouts/request")
            .send({
                amount: 200,
                method: "upi",
                details: { upiId: "test@upi" }
            })
        const payoutId2 = reqRes2.body.data._id

        // 6. Admin Approve Payout
        console.log("👉 Admin Approving Payout...")
        const approveRes = await request(app)
            .post(`/api/admin/payouts/${payoutId2}/action`)
            .send({ action: "approve" })

        if (approveRes.status !== 200) throw new Error(`Approve failed: ${approveRes.body.message}`)

        const payoutApproved = await Payout.findById(payoutId2)
        if (payoutApproved?.status !== "approved") throw new Error("Status update failed")
        console.log("✅ Payout Approved Successfully")

        console.log("\n🎉 ALL PAYOUT SYSTEM TESTS PASSED!")
        process.exit(0)
    } catch (error: any) {
        console.error("❌ Verification Failed:", error.message)
        process.exit(1)
    }
}

runVerification()
