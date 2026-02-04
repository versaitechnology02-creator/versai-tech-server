import axios from "axios"
import http from "http"
import https from "https"
import dns from "dns"

export const UNPAY_BASE_URL =
  process.env.UNPAY_BASE_URL || "https://unpay.in/tech/api"

export const UNPAY_PARTNER_ID = process.env.UNPAY_PARTNER_ID || ""
export const UNPAY_API_KEY = process.env.UNPAY_API_KEY || ""
export const UNPAY_AES_KEY = process.env.UNPAY_AES_KEY || ""
export const UNPAY_IV = process.env.UNPAY_IV || ""

const lookup4 = (
  hostname: string,
  options: any,
  callback?: (err: NodeJS.ErrnoException | null, address: string) => void
) => {
  if (typeof options === "function") {
    return dns.lookup(hostname, { family: 4 }, options)
  }
  return dns.lookup(hostname, { family: 4 }, callback as any)
}

const httpAgent = new http.Agent({ lookup: lookup4 })
const httpsAgent = new https.Agent({ lookup: lookup4 })

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
