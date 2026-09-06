const express = require("express");
const path = require("path");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");

const swaggerSpec = require("./config/swagger");
const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");
const customerRoutes = require("./routes/customer.routes");
const customerActivityRoutes = require("./routes/customerActivity.routes");
const customerStageRoutes = require("./routes/customerStage.routes");
const followUpRoutes = require("./routes/followUp.routes");
const productRoutes = require("./routes/product.routes");
const quotationRoutes = require("./routes/quotation.routes");
const orderRoutes = require("./routes/order.routes");
const paymentRoutes = require("./routes/payment.routes");
const orderReturnRoutes = require("./routes/orderReturn.routes");
const salespersonPerformanceRoutes = require("./routes/salespersonPerformance.routes");
const salespersonDashboardRoutes = require("./routes/salespersonDashboard.routes");
const managerDashboardRoutes = require("./routes/managerDashboard.routes");
const adminDashboardRoutes = require("./routes/adminDashboard.routes");
const customerDashboardRoutes = require("./routes/customerDashboard.routes");
const notificationRoutes = require("./routes/notification.routes");
const reportRoutes = require("./routes/report.routes");
const messageRoutes = require("./routes/message.routes");
const quotationRequestRoutes = require("./routes/quotationRequest.routes");
const BusinessError = require("./utils/errors/businessError");

const app = express();

const allowedOrigins = [
    process.env.FRONTEND_URL,
    ...(process.env.ADDITIONAL_ORIGINS
        ? process.env.ADDITIONAL_ORIGINS.split(",").map((o) => o.trim())
        : []),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
    "http://localhost:3000",
].filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new BusinessError(`Origin ${origin} not allowed by CORS`, 403));
        },
        credentials: true,
    })
);

app.use(express.json());

app.use("/api/customers", customerStageRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/auth", authRoutes);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/", healthRoutes);
app.use("/api/activities", customerActivityRoutes);
app.use("/api/followups", followUpRoutes);
app.use("/api/products", productRoutes);
app.use("/api/quotations", quotationRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/returns", orderReturnRoutes);
app.use("/api/performance/salesperson", salespersonPerformanceRoutes);
app.use("/api/dashboard/manager", managerDashboardRoutes);
app.use("/api/dashboard/admin", adminDashboardRoutes);
app.use("/api/dashboard/customer", customerDashboardRoutes);
app.use("/api/dashboard/salesperson", salespersonDashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/quotation-requests", quotationRequestRoutes);
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

const notFound = require("./middlewares/notFound.middleware");
const errorHandler = require("./middlewares/error.middleware");

app.use(notFound);
app.use(errorHandler);

module.exports = app;
