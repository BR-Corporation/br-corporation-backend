const express = require("express");

const router = express.Router();

const paymentController = require("../controllers/payment.controller");

const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/role.middleware");
const {
    createPaymentValidator,
    getPaymentsValidator
} = require("../validators/payment.validator");
const validate = require("../middlewares/validation.middleware");

// ----------------------------
// Create Payment (Admin, Manager, Salesperson)
// ----------------------------

router.post(
    "/",
    authenticate,
    authorize("admin", "manager", "salesperson"),
    createPaymentValidator,
    validate,
    paymentController.createPayment
);

// ----------------------------
// Get Payments (All authenticated roles)
// ----------------------------

router.get(
    "/",
    authenticate,
    paymentController.getPayments
);

// ----------------------------
// Get Customer Payments (All authenticated roles)
// ----------------------------

router.get(
    "/customer/:customerProfileId",
    authenticate,
    getPaymentsValidator,
    validate,
    paymentController.getCustomerPayments
);

// ----------------------------
// Get Order Payments (All authenticated roles)
// ----------------------------

router.get(
    "/order/:orderId",
    authenticate,
    paymentController.getOrderPayments
);

// ----------------------------
// Delete Payment (Admin only) — reverses order + customer totals
// ----------------------------

router.delete(
    "/:paymentId",
    authenticate,
    authorize("admin"),
    paymentController.deletePayment
);

module.exports = router;
