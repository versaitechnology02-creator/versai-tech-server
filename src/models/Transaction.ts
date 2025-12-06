import mongoose from "mongoose"

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
    },
    paymentId: {
      type: String,
      default: "",
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    type: {
      type: String,
      enum: ["payment", "payout", "refund"],
      default: "payment",
    },
    customer: {
      name: String,
      email: String,
      phone: String,
    },
    description: String,
    notes: mongoose.Schema.Types.Mixed,
    paymentMethod: String,
    refundId: String,
    refundAmount: Number,
  },
  { timestamps: true },
)

export default mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema)