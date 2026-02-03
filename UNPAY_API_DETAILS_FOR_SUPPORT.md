# UnPay Dynamic QR – API Details (for UnPay Support)

**Purpose:** Link/QR generate karne ke liye hum jo API hit kar rahe hain, uski details.

---

## 1. API URL (jo hum hit kar rahe hain)

### Option A – LIVE (production)
- **Full URL:** `https://api.unpay.in/next/upi/request/qr`
- **Method:** `POST`

### Option B – Tech API (agar aap ye base use karte ho)
- **Full URL:** `https://unpay.in/tech/api/next/upi/request/qr`
- **Method:** `POST`

**Note:** Hum production mein Option A use kar rahe hain. Server par `api.unpay.in` resolve nahi ho raha (DNS: `getaddrinfo ENOTFOUND api.unpay.in`), isliye agar live API alag host pe hai to bata dein.

---

## 2. Headers

| Header           | Value              |
|------------------|--------------------|
| Content-Type     | application/json   |
| Accept           | application/json   |
| api-key          | \<UNPAY_API_KEY\>  |

---

## 3. Request Body (JSON – no encryption in LIVE)

```json
{
  "partner_id": "4358",
  "apitxnid": "order_SBHYz3y5THUNzC",
  "amount": "100",
  "webhook": "https://api.versaitechnology.com/api/payments/webhook/unpay",
  "ip": "72.60.201.247"
}
```

**Fields:**
- `partner_id` – UnPay partner ID (e.g. 4358)
- `apitxnid` – Our order ID (Razorpay order id format)
- `amount` – Amount in INR (string)
- `webhook` – Callback URL jahan UnPay status bhejega
- `ip` – Server public IP (whitelisted)

LIVE mode mein hum **plain JSON** bhej rahe hain (no AES encryption, no `body` field).

---

## 4. Postman / cURL Example

### Postman
- **Method:** POST  
- **URL:** `https://api.unpay.in/next/upi/request/qr`  
- **Headers:**  
  - `Content-Type`: `application/json`  
  - `Accept`: `application/json`  
  - `api-key`: \<your UnPay API key\>  
- **Body (raw JSON):**
```json
{
  "partner_id": "4358",
  "apitxnid": "order_TEST123",
  "amount": "100",
  "webhook": "https://api.versaitechnology.com/api/payments/webhook/unpay",
  "ip": "72.60.201.247"
}
```

### cURL
```bash
curl -X POST "https://api.unpay.in/next/upi/request/qr" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "api-key: YOUR_UNPAY_API_KEY" \
  -d '{
    "partner_id": "4358",
    "apitxnid": "order_TEST123",
    "amount": "100",
    "webhook": "https://api.versaitechnology.com/api/payments/webhook/unpay",
    "ip": "72.60.201.247"
  }'
```

---

## 5. Error jo aa raha hai

- **Message:** `Invalid encryption request or body value missing`
- **DNS (kisi servers par):** `getaddrinfo ENOTFOUND api.unpay.in`

Hum LIVE mein encrypted body nahi bhej rahe, sirf above JSON. Batayein:
- LIVE Dynamic QR ke liye exact URL kya hai?
- Request body format (plain JSON ya encrypted) kya hona chahiye?
- `api.unpay.in` vs `unpay.in/tech/api` – kaunsa use karna hai?

---

## 6. Webhook URL (callback – jahan aap status bhejte ho)

- **URL:** `https://api.versaitechnology.com/api/payments/webhook/unpay`
- **Method:** POST (UnPay se expected)

Yeh hi URL hum request body mein `webhook` field me bhej rahe hain.
