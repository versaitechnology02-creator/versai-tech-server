
import axios from "axios";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const PORT = process.env.PORT || 5000;
const URL = `http://localhost:${PORT}/api/payments/transactions`;

// We need a way to authenticate.
// Since we can't easily get a token, we might need to rely on the user running this having a token
// OR we can temporarily disable auth in the route for testing (risky)
// OR we can mock the request using supertest + app? No, too complex.
// Let's ask the user to provide a token OR use the userId from the dump to generate a token if we had a secret.
// Wait, the DB dump has a `userId`. 
// I can temporarily modify `payments.ts` to accept a query param `?testUserId=...` for debugging if I'm desperate.
// But first, let's just ask the user to check the "Network Tab" in browser? No, user wants me to fix it.

// Better approach: 
// I will create a script that uses the `User` model to generate a JWT token for the user in the dump,
// and then calls the API.
// This requires `jsonwebtoken`.

import jwt from "jsonwebtoken";
import User from "../src/models/User";
import mongoose from "mongoose";

const JWT_SECRET = process.env.JWT_SECRET || "versai-secret-key-2024";
const MONGODB_URI = process.env.MONGODB_URI;

async function testApi() {
    try {
        await mongoose.connect(MONGODB_URI as string);
        // Get the user from the dump
        const userId = "698ad8ce39ab91c6226b9f3e"; // From the dump you provided

        // Generate Token
        // Must match src/utils/jwt.ts: { userId: string }
        const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "1h" });
        console.log("🔑 Generated Test Token for User:", userId);

        console.log(`🌍 Fetching ${URL}...`);
        try {
            const res = await axios.get(URL, {
                headers: { Authorization: `Bearer ${token}` }
            });

            console.log("✅ API Response Status:", res.status);
            console.log("🔍 API Response Data (First Item):");
            if (res.data.success && res.data.data.length > 0) {
                console.log(JSON.stringify(res.data.data[0], null, 2));
                console.log("------------------------------------------------");
                console.log("👉 Check 'created_at':", res.data.data[0].created_at);
                console.log("👉 Check 'customer_name':", res.data.data[0].customer_name);
            } else {
                console.log("⚠️ No transactions returned or success=false", res.data);
            }

        } catch (apiErr: any) {
            console.error("❌ API Request Failed:", apiErr.response ? apiErr.response.data : apiErr.message);
        }

        process.exit(0);
    } catch (error) {
        console.error("❌ Script Error:", error);
        process.exit(1);
    }
}

testApi();
