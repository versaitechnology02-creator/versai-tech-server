import axios from "axios"
import http from "http"
import https from "https"
import dns from "dns"

export const UNPAY_BASE_URL = process.env.UNPAY_BASE_URL
if (!UNPAY_BASE_URL) {
  throw new Error("UNPAY_BASE_URL is not configured")
}

// Runtime confirmation of Unpay URL
console.log("✅ UNPAY URL AT RUNTIME =", UNPAY_BASE_URL)

export const UNPAY_PARTNER_ID = process.env.UNPAY_PARTNER_ID || ""
export const UNPAY_API_KEY = process.env.UNPAY_API_KEY || ""
export const UNPAY_AES_KEY = process.env.UNPAY_AES_KEY || ""
export const UNPAY_IV = process.env.UNPAY_IV || ""

const lookup4 = (
  hostname: string,
  options: any,
  callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
) => {
  // If options is the callback, shift arguments
  if (typeof options === "function") {
    callback = options
    options = {}
  }

  // Force IPv4
  return dns.lookup(hostname, { family: 4 }, callback as any)
}

const httpAgent = new http.Agent({
  family: 4,
  lookup: lookup4
})

const httpsAgent = new https.Agent({
  family: 4,
  lookup: lookup4
})

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
