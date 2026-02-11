import axios from "axios"
import http from "http"
import https from "https"
import dns from "dns"

// ======================
// ENV VALIDATION
// ======================

export const UNPAY_BASE_URL = process.env.UNPAY_BASE_URL
if (!UNPAY_BASE_URL) {
  throw new Error("UNPAY_BASE_URL is not configured")
}

export const UNPAY_PARTNER_ID = process.env.UNPAY_PARTNER_ID || ""
export const UNPAY_API_KEY = process.env.UNPAY_API_KEY || ""
export const UNPAY_AES_KEY = process.env.UNPAY_AES_KEY || ""

if (!UNPAY_PARTNER_ID) {
  throw new Error("UNPAY_PARTNER_ID is not configured")
}

if (!UNPAY_API_KEY) {
  throw new Error("UNPAY_API_KEY is not configured")
}

if (!UNPAY_AES_KEY) {
  throw new Error("UNPAY_AES_KEY is not configured")
}

// Runtime confirmation
console.log("✅ UNPAY URL AT RUNTIME =", UNPAY_BASE_URL)

// ======================
// FORCE IPV4 (CRITICAL)
// ======================

const lookup4 = (
  hostname: string,
  options: any,
  callback?: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number
  ) => void
) => {
  if (typeof options === "function") {
    callback = options
    options = {}
  }

  return dns.lookup(hostname, { family: 4 }, callback as any)
}

const httpAgent = new http.Agent({
  lookup: lookup4,
})

const httpsAgent = new https.Agent({
  lookup: lookup4,
})

// ======================
// AXIOS CLIENT
// ======================

const unpayClient = axios.create({
  baseURL: UNPAY_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "api-key": UNPAY_API_KEY,
  },
  httpAgent,
  httpsAgent,
})

export default unpayClient
