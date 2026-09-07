const nodemailer = require("nodemailer");

/**
 * Email delivery — three strategies, tried in this order:
 *   1. Brevo HTTPS API when BREVO_API_KEY is set (best — port 443, never blocked)
 *   2. Brevo SMTP  when BREVO_SMTP_USER + BREVO_SMTP_KEY are set (port 587)
 *   3. Gmail SMTP  as final fallback (port 465/587, unreliable from cloud hosts)
 */

const useBrevoApi = !!process.env.BREVO_API_KEY;
const useBrevoSmtp = !useBrevoApi && !!(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_KEY);

const smtpTransporter = useBrevoSmtp
    ? nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 587,
        secure: false,
        auth: {
            user: process.env.BREVO_SMTP_USER,
            pass: process.env.BREVO_SMTP_KEY,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
    })
    : nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
    });

const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.BREVO_SMTP_USER;
const FROM_NAME = "BR Corporation";

const welcomeHtml = ({ Name, email, temporaryPassword }) => `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; background:#f4f4f4; margin:0; padding:30px; }
        .container { max-width:600px; margin:auto; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1); }
        .header { background:#0d6efd; color:white; text-align:center; padding:20px; }
        .content { padding:30px; color:#333; }
        .credentials { background:#f8f9fa; padding:15px; border-radius:8px; margin-top:20px; }
        .footer { text-align:center; padding:20px; color:#777; font-size:13px; }
        .warning { color:red; font-weight:bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><h2>Welcome to BR Corporation 🚀</h2></div>
        <div class="content">
            <p>Hi <strong>${Name}</strong>,</p>
            <p>Your employee account has been successfully created by the administrator.</p>
            <div class="credentials">
                <h3>Login Credentials</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>
            </div>
            <p class="warning">Please login using the above credentials and change your password immediately.</p>
            <p>If you were not expecting this email, please contact your administrator.</p>
        </div>
        <div class="footer">© ${new Date().getFullYear()} BR Corporation</div>
    </div>
</body>
</html>
`;

const sendViaBrevoApi = async ({ Name, email, temporaryPassword }) => {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": process.env.BREVO_API_KEY,
        },
        body: JSON.stringify({
            sender: { name: FROM_NAME, email: FROM_EMAIL },
            to: [{ email, name: Name }],
            subject: "Welcome to BR Corporation",
            htmlContent: welcomeHtml({ Name, email, temporaryPassword }),
        }),
        signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Brevo API ${res.status}: ${body.slice(0, 200)}`);
    }
};

const sendEmployeeWelcomeEmail = async ({ Name, email, temporaryPassword }) => {
    if (useBrevoApi) {
        return sendViaBrevoApi({ Name, email, temporaryPassword });
    }

    // Fall through to SMTP (nodemailer)
    const mailOptions = {
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to: email,
        subject: "Welcome to BR Corporation",
        html: welcomeHtml({ Name, email, temporaryPassword }),
    };
    await smtpTransporter.sendMail(mailOptions);
};

const testEmailConnection = async () => {
    if (useBrevoApi) {
        console.log("✅ Brevo HTTPS API configured (port 443).");
        return;
    }
    try {
        await smtpTransporter.verify();
        console.log(`✅ ${useBrevoSmtp ? "Brevo" : "Gmail"} SMTP connected successfully.`);
    } catch (error) {
        console.error(`❌ ${useBrevoSmtp ? "Brevo" : "Gmail"} SMTP connection failed.`);
        console.error(error);
    }
};

module.exports = {
    sendEmployeeWelcomeEmail,
    testEmailConnection,
};
