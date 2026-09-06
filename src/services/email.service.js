const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendEmployeeWelcomeEmail = async ({
    Name,
    email,
    temporaryPassword
}) => {

    const mailOptions = {
        from: `"BR Corporation" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Welcome to BR Corporation",

        html: `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body{
                    font-family: Arial, sans-serif;
                    background:#f4f4f4;
                    margin:0;
                    padding:30px;
                }

                .container{
                    max-width:600px;
                    margin:auto;
                    background:#ffffff;
                    border-radius:10px;
                    overflow:hidden;
                    box-shadow:0 4px 10px rgba(0,0,0,0.1);
                }

                .header{
                    background:#0d6efd;
                    color:white;
                    text-align:center;
                    padding:20px;
                }

                .content{
                    padding:30px;
                    color:#333;
                }

                .credentials{
                    background:#f8f9fa;
                    padding:15px;
                    border-radius:8px;
                    margin-top:20px;
                }

                .footer{
                    text-align:center;
                    padding:20px;
                    color:#777;
                    font-size:13px;
                }

                .warning{
                    color:red;
                    font-weight:bold;
                }
            </style>
        </head>

        <body>

            <div class="container">

                <div class="header">
                    <h2>Welcome to BR Corporation 🚀</h2>
                </div>

                <div class="content">

                    <p>Hi <strong>${Name}</strong>,</p>

                    <p>Your employee account has been successfully created by the administrator.</p>

                    <div class="credentials">

                        <h3>Login Credentials</h3>

                        <p><strong>Email:</strong> ${email}</p>

                        <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>

                    </div>

                    <p class="warning">
                        Please login using the above credentials and change your password immediately.
                    </p>

                    <p>
                        If you were not expecting this email, please contact your administrator.
                    </p>

                </div>

                <div class="footer">

                    © ${new Date().getFullYear()} BR Corporation

                </div>

            </div>

        </body>
        </html>
        `
    };

    await transporter.sendMail(mailOptions);
};

const testEmailConnection = async () => {
    try {
        await transporter.verify();
        console.log("✅ Gmail SMTP connected successfully.");
    } catch (error) {
        console.error("❌ Gmail SMTP connection failed.");
        console.error(error);
    }
};

module.exports = {
    sendEmployeeWelcomeEmail,
    testEmailConnection
};