import mongoose from "mongoose"

/**
 * GatewayPayout — Tracks every payout dispatched to RezoPay (pg.sdmrc.in).
 *
 * Separate from the internal `Payout` model (which is for manual/wallet payouts).
 * This model holds the full lifecycle of a RezoPay bank-transfer payout:
 * pending → processing → success | failed | returned
 */
const gatewayPayoutSchema = new mongoose.Schema(
    {
        // Internal reference
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // Our unique idempotency key — sent as `orderid` to RezoPay
        // Format: POUT_{userId}_{timestamp}_{random4}
        orderid: {
            type: String,
            required: true,
            unique: true, // Enforces idempotency at DB level
            index: true,
        },

        // Beneficiary details (stored encrypted-at-rest consideration: plain for MVP, encrypt for PROD)
        fullName: { type: String, required: true, trim: true },
        mobile: { type: String, required: true, trim: true },
        accountNumber: { type: String, required: true, trim: true },
        ifsc: { type: String, required: true, trim: true, uppercase: true },
        bank: { type: String, required: true, trim: true },

        // Amount in INR
        amount: { type: Number, required: true, min: 1 },

        // RezoPay lifecycle status
        // pending    → submitted to RezoPay, waiting for confirmation
        // processing → RezoPay accepted, pending bank settlement
        // success    → Bank confirmed (callback received with status=success)
        // failed     → Gateway/bank rejection
        // returned   → Returned by bank after initial credit
        status: {
            type: String,
            enum: ["pending", "processing", "success", "failed", "returned"],
            default: "pending",
            index: true,
        },

        // UTR from the bank network (available on success callback)
        utr: { type: String, default: "" },

        // RezoPay's callback message
        gatewayMessage: { type: String, default: "" },

        // Admin who approved this payout (for audit trail)
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        // Admin approval timestamp
        approvedAt: { type: Date, default: null },

        // Timestamps from RezoPay callback
        gatewayUpdatedAt: { type: Date, default: null },

        // Retry tracking (prevent duplicate gateway calls)
        initiatedAt: { type: Date, default: null },
        retryCount: { type: Number, default: 0, min: 0 },

        // Full raw callback body for audit
        callbackPayload: { type: mongoose.Schema.Types.Mixed, default: null },

        // Status check result from last poll
        lastStatusCheck: { type: mongoose.Schema.Types.Mixed, default: null },
        lastStatusCheckedAt: { type: Date, default: null },
    },
    {
        timestamps: true, // createdAt, updatedAt
        collection: "gateway_payouts",
    }
)

// Compound index for efficient status polling queries
gatewayPayoutSchema.index({ status: 1, createdAt: -1 })
gatewayPayoutSchema.index({ userId: 1, createdAt: -1 })

export default mongoose.models.GatewayPayout ||
    mongoose.model("GatewayPayout", gatewayPayoutSchema)
