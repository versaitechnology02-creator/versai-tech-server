/**
 * EMERGENCY MANUAL FIX SCRIPT
 * ============================
 * Directly updates a transaction status in MongoDB.
 * Run when UnPay webhook fails to arrive.
 *
 * Usage:
 *   node emergency-fix.js <orderId> [status]
 *   node emergency-fix.js order_SJWtP8ricKzjnA completed
 *   node emergency-fix.js order_SJWtP8ricKzjnA failed
 *
 * Default status is "completed" if not specified.
 */

const mongoose = require("mongoose")
const path = require("path")
const fs = require("fs")

// ─── Load .env ───────────────────────────────
const envPaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, ".env"),
    path.resolve(__dirname, "..", ".env"),
]
for (const p of envPaths) {
    if (fs.existsSync(p)) {
        require("dotenv").config({ path: p })
        console.log(`✅ Loaded .env from: ${p}`)
        break
    }
}

// ─── Args ────────────────────────────────────
const args = process.argv.slice(2)
const orderId = args[0]
const newStatus = args[1] || "completed"

if (!orderId) {
    console.error("❌ Usage: node emergency-fix.js <orderId> [completed|failed]")
    console.error("   Example: node emergency-fix.js order_SJWtP8ricKzjnA completed")
    process.exit(1)
}

if (!["completed", "failed", "pending"].includes(newStatus)) {
    console.error(`❌ Invalid status: ${newStatus}. Use: completed | failed | pending`)
    process.exit(1)
}

// ─── Simple Transaction Schema ────────────────
const TransactionSchema = new mongoose.Schema({}, { strict: false })
const Transaction = mongoose.model("Transaction", TransactionSchema)

async function run() {
    const mongoUri = process.env.MONGODB_URI
    if (!mongoUri) {
        console.error("❌ MONGODB_URI not set in .env")
        process.exit(1)
    }

    console.log(`\n🔌 Connecting to MongoDB...`)
    await mongoose.connect(mongoUri)
    console.log("✅ MongoDB connected\n")

    // Find the transaction first
    const existing = await Transaction.findOne({ orderId })

    if (!existing) {
        console.error(`❌ Transaction NOT FOUND for orderId: ${orderId}`)
        console.error(`   Check your MongoDB for the correct orderId.`)
        await mongoose.disconnect()
        process.exit(1)
    }

    console.log(`📋 Found Transaction:`)
    console.log(`   orderId:  ${existing.orderId}`)
    console.log(`   status:   ${existing.status}`)
    console.log(`   amount:   ${existing.amount}`)
    console.log(`   provider: ${existing.notes?.provider || "unknown"}`)
    console.log(`   created:  ${existing.createdAt}`)

    if (existing.status === "completed") {
        console.log(`\nℹ️  Transaction already COMPLETED. No change needed.`)
        await mongoose.disconnect()
        process.exit(0)
    }

    // Update
    const updated = await Transaction.findOneAndUpdate(
        { orderId },
        {
            $set: {
                status: newStatus,
                updatedAt: new Date(),
                paymentId: `MANUAL_FIX_${Date.now()}`,
                "notes.completed_via": "emergency_manual_fix",
                "notes.manual_fix_time": new Date().toISOString(),
            },
        },
        { new: true }
    )

    console.log(`\n✅ Transaction UPDATED:`)
    console.log(`   orderId: ${updated.orderId}`)
    console.log(`   status:  ${existing.status} → ${updated.status}`)
    console.log(`   updated: ${updated.updatedAt}`)
    console.log(`\n🎉 Done! The transaction is now marked as "${newStatus}".`)
    console.log(`   The dashboard will reflect this on next refresh.\n`)

    await mongoose.disconnect()
}

run().catch((err) => {
    console.error("🔥 Error:", err.message)
    process.exit(1)
})
