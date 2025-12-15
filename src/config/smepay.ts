import axios from "axios"

const SMEPAY_BASE_URL = process.env.SMEPAY_BASE_URL || "https://api.smepay.io"
const SMEPAY_API_KEY = process.env.SMEPAY_API_KEY || ""

const smepayClient = axios.create({
  baseURL: SMEPAY_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    ...(SMEPAY_API_KEY ? { Authorization: `Bearer ${SMEPAY_API_KEY}` } : {}),
  },
})

export default smepayClient
