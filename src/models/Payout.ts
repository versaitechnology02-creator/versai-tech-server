import mongoose from "mongoose";

const payoutSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 1, // Minimum payout amount
        },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected", "completed"],
            default: "pending",
        },
        method: {
            type: String,
            enum: ["bank_transfer", "upi"],
            required: true,
        },
        details: {
            accountHolderName: String,
            bankName: String,
            accountNumber: String,
            ifscCode: String,
            upiId: String,
        },
        adminComment: {
            type: String,
            default: "",
        },
        processedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

export default mongoose.models.Payout || mongoose.model("Payout", payoutSchema);
