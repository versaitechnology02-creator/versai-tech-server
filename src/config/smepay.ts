import axios from "axios"

export const SMEPAY_BASE_URL = process.env.SMEPAY_BASE_URL || "https://extranet.smepay.in/api"
export const SMEPAY_CLIENT_ID = process.env.SMEPAY_CLIENT_ID || ""
export const SMEPAY_CLIENT_SECRET = process.env.SMEPAY_CLIENT_SECRET || ""

export const smepayAuthClient = axios.create({
  baseURL: SMEPAY_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
})

export const smepayApiClient = axios.create({
  baseURL: SMEPAY_BASE_URL,
  timeout: 20000,
  headers: {
    "Content-Type": "application/json",
  },
})
