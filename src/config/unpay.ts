import axios from "axios"

const UNPAY_BASE_URL = process.env.UNPAY_BASE_URL || "https://api.unpay.com"
const UNPAY_API_KEY = process.env.UNPAY_API_KEY || ""

const unpayClient = axios.create({
  baseURL: UNPAY_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    ...(UNPAY_API_KEY ? { Authorization: `Bearer ${UNPAY_API_KEY}` } : {}),
  },
})

export default unpayClient
