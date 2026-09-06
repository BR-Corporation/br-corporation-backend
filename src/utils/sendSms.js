/**
 * Send an OTP SMS.
 *
 * Provider priority:
 *   1. Twilio     — if TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER are set
 *   2. MSG91      — if MSG91_AUTH_KEY + MSG91_TEMPLATE_ID are set
 *   3. dev fallback — prints the OTP to the backend log
 */

const MSG91_OTP_ENDPOINT = "https://control.msg91.com/api/v5/otp";

let twilioClient = null;
const getTwilioClient = () => {
    if (twilioClient) return twilioClient;
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
    const twilio = require("twilio");
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    return twilioClient;
};

const normalizeMobile = (phoneNumber, { withPlus } = { withPlus: false }) => {
    const digits = String(phoneNumber || "").replace(/\D/g, "");
    if (!digits) return null;
    const cc = (process.env.SMS_DEFAULT_COUNTRY || process.env.MSG91_DEFAULT_COUNTRY || "91")
        .replace(/\D/g, "");
    const full = digits.length > 10 ? digits : `${cc}${digits}`;
    return withPlus ? `+${full}` : full;
};

const isTwilioConfigured = () =>
    Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM_NUMBER
    );

const isMsg91Configured = () =>
    Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);

const buildOtpBody = (otp) => {
    const template = process.env.SMS_OTP_TEMPLATE
        || "Your BR Corporation OTP is {{OTP}}. Valid for 5 minutes. Do not share this code.";
    const body = template.replace(/\{\{OTP\}\}/g, String(otp));
    // Twilio trial accounts require this prefix on every outgoing SMS.
    // It is added automatically by Twilio if omitted, but adding it explicitly
    // avoids the "Invalid template name" A2P guard on some trial tiers.
    if (process.env.TWILIO_TRIAL === "true") {
        return `Sent from your Twilio trial account - ${body}`;
    }
    return body;
};

const sendViaTwilio = async (phoneNumber, otp) => {
    const client = getTwilioClient();
    if (!client) throw new Error("Twilio client not initialized.");
    const to = normalizeMobile(phoneNumber, { withPlus: true });
    if (!to) throw new Error("Invalid phone number for SMS.");
    const from = process.env.TWILIO_FROM_NUMBER;
    const body = buildOtpBody(otp);

    const message = await client.messages.create({ to, from, body });
    return { sid: message.sid, status: message.status };
};

const sendViaMsg91 = async (phoneNumber, otp) => {
    const mobile = normalizeMobile(phoneNumber);
    if (!mobile) throw new Error("Invalid phone number for SMS.");

    const params = new URLSearchParams({
        template_id: process.env.MSG91_TEMPLATE_ID,
        mobile,
        authkey: process.env.MSG91_AUTH_KEY,
        otp: String(otp),
        otp_length: String(String(otp).length),
        otp_expiry: String(process.env.OTP_EXPIRY_MINUTES || 5),
    });
    if (process.env.MSG91_SENDER_ID) params.set("sender", process.env.MSG91_SENDER_ID);

    const res = await fetch(`${MSG91_OTP_ENDPOINT}?${params.toString()}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authkey: process.env.MSG91_AUTH_KEY,
        },
    });

    let payload = null;
    try { payload = await res.json(); } catch { /* ignore */ }

    const success = payload && (payload.type === "success" || payload.request_id);
    if (!success) {
        const msg = (payload && (payload.message || payload.error)) || `HTTP ${res.status}`;
        throw new Error(`MSG91 send failed: ${msg}`);
    }
    return payload;
};

const sendSms = async (phoneNumber, otp) => {
    if (isTwilioConfigured()) {
        try {
            const r = await sendViaTwilio(phoneNumber, otp);
            console.log(`[Twilio] OTP sent to ${phoneNumber} (sid=${r.sid}, status=${r.status})`);
            return;
        } catch (err) {
            console.error(`[Twilio] Failed to send OTP to ${phoneNumber}:`, err.message);
            throw err;
        }
    }

    if (isMsg91Configured()) {
        try {
            const r = await sendViaMsg91(phoneNumber, otp);
            console.log(`[MSG91] OTP dispatched to ${phoneNumber} (request_id=${r.request_id || "?"})`);
            return;
        } catch (err) {
            console.error(`[MSG91] Failed to send OTP to ${phoneNumber}:`, err.message);
            throw err;
        }
    }

    // Dev fallback
    console.log("===================================");
    console.log(`[DEV] Sending OTP to ${phoneNumber}`);
    console.log(`[DEV] OTP : ${otp}`);
    console.log("===================================");
};

module.exports = sendSms;
