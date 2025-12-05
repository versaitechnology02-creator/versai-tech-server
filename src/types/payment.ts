export interface CreateOrderRequest {
  amount: number
  currency?: string
  description?: string
  customer_id?: string
  receipt?: string
  notes?: Record<string, string>
}

export interface CreateOrderResponse {
  id: string
  entity: string
  amount: number
  currency: string
  receipt: string
  status: string
  created_at: number
}

export interface VerifyPaymentRequest {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export interface VerifyPaymentResponse {
  success: boolean
  message: string
  order_id?: string
  payment_id?: string
}

export interface PaymentTransaction {
  id: string
  order_id: string
  payment_id: string
  amount: number
  currency: string
  status: "pending" | "completed" | "failed"
  customer_email?: string
  customer_name?: string
  notes?: Record<string, string>
  created_at: string
  updated_at: string
}
