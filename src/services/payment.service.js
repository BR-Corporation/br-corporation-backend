const Payment = require("../models/payment.model");
const Order = require("../models/order.model");
const CustomerProfile = require("../models/customerProfile.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildPayment,
    buildPaymentList,
    buildPaymentSummary
} = require("../dto/payment.dto");

const { verifyCustomerOwnership } = require("../helpers/customerOwnership.helper");
const { createInternalActivity } = require("./customerActivity.service");

const {
    createNotification
} = require("./notification.service");

// ----------------------------
// Calculation Helpers
// ----------------------------

const roundToTwo = (value) => {
    return Math.round(value * 100) / 100;
};

// ----------------------------
// Calculate Order Outstanding Amount
// ----------------------------

const calculateOrderOutstanding = async (orderId) => {

    const order = await Order.findById(orderId);

    if (!order) {

        throw new BusinessError("Order not found.", 404);

    }

    const payments = await Payment.find({ order: orderId });

    const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);

    const outstanding = roundToTwo(order.grandTotal - totalPaid);

    return {

        grandTotal: order.grandTotal,

        totalPaid: roundToTwo(totalPaid),

        outstanding: outstanding > 0 ? outstanding : 0

    };

};

// ----------------------------
// Create Payment
// ----------------------------

const createPayment = async (paymentData, loggedInUser) => {

    const {
        orderId,
        amount,
        paymentMethod,
        paymentDate,
        transactionReference,
        notes
    } = paymentData;

    const order = await Order.findById(orderId)

        .populate({ path: "customerProfile", select: "user businessName" });

    if (!order) {

        throw new BusinessError("Order not found.", 404);

    }

    if (order.orderStatus === "cancelled") {

        throw new BusinessError("Cannot record payment for a cancelled order.", 400);

    }

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(order.customerProfile._id, loggedInUser);

    }

    const paymentAmount = roundToTwo(amount);

    const orderTotals = await calculateOrderOutstanding(orderId);

    if (paymentAmount > orderTotals.outstanding) {

        throw new BusinessError(

            `Payment amount (${paymentAmount}) exceeds outstanding amount (${orderTotals.outstanding}).`,

            400

        );

    }

    const payment = await Payment.create({

        customerProfile: order.customerProfile,

        order: orderId,

        amount: paymentAmount,

        paymentMethod,

        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),

        transactionReference: transactionReference || "",

        notes: notes || "",

        createdBy: loggedInUser._id

    });

    await payment.populate({

        path: "createdBy",

        select: "Name email"

    });

    // Update order payment status
    const payments = await Payment.find({ order: orderId });

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    const newOutstanding = roundToTwo(order.grandTotal - totalPaid);

    if (newOutstanding <= 0) {

        order.paymentStatus = "paid";

    } else if (totalPaid > 0) {

        order.paymentStatus = "partial";

    } else {

        order.paymentStatus = "pending";

    }

    await order.save();

    // Update customer financial metrics
    const customerProfile = await CustomerProfile.findById(order.customerProfile);

    if (customerProfile) {

        const previousOutstanding = customerProfile.outstandingAmount || 0;

        customerProfile.outstandingAmount = roundToTwo(Math.max(0, previousOutstanding - paymentAmount));

        await customerProfile.save();

    }

    // Create customer activity
    const activityTitle = newOutstanding <= 0 ? "Payment Received (Full)" : "Payment Received (Partial)";

    await createInternalActivity({

        customerProfileId: order.customerProfile,

        createdBy: loggedInUser._id,

        activityType: "order",

        title: activityTitle,

        description: `Payment of ${paymentAmount} received for Order #${orderId}. Outstanding: ${newOutstanding}.`,

        metadata: {

            orderId,

            paymentId: payment._id,

            amount: paymentAmount,

            paymentMethod,

            totalPaid: roundToTwo(totalPaid),

            outstanding: newOutstanding,

            grandTotal: order.grandTotal

        }

    });

    if (customerProfile) {

        await createNotification({

            recipient: customerProfile.user,

            type: "payment_received",

            title: activityTitle,

            message: `Payment of ${paymentAmount} received for Order #${orderId}. Outstanding: ${newOutstanding}.`,

            referenceEntity: "payment",

            referenceId: payment._id

        });

    }

    return {

        success: true,

        message: "Payment recorded successfully.",

        payment: buildPayment(payment),

        order: {

            id: order._id,

            paymentStatus: order.paymentStatus,

            grandTotal: order.grandTotal,

            totalPaid: roundToTwo(totalPaid),

            outstanding: newOutstanding

        }

    };

};

// ----------------------------
// Get Payments
// ----------------------------

const getPayments = async (query, loggedInUser) => {

    const {
        page = 1,
        limit = 10,
        customerProfileId,
        orderId,
        paymentMethod,
        startDate,
        endDate,
        sort = "-createdAt"
    } = query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const skip = (pageNumber - 1) * limitNumber;

    const filter = {};

    if (customerProfileId) {
        filter.customerProfile = customerProfileId;
    }

    if (orderId) {
        filter.order = orderId;
    }

    if (paymentMethod) {
        filter.paymentMethod = paymentMethod;
    }

    if (startDate || endDate) {
        filter.paymentDate = {};

        if (startDate) {
            filter.paymentDate.$gte = new Date(startDate);
        }

        if (endDate) {
            filter.paymentDate.$lte = new Date(endDate);
        }
    }

    if (loggedInUser.role === "salesperson") {

        const customerProfiles = await CustomerProfile.find({

            assignedSalesperson: loggedInUser._id

        }).select("_id");

        const customerProfileIds = customerProfiles.map(cp => cp._id);

        filter.customerProfile = { $in: customerProfileIds };

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findOne({

            user: loggedInUser._id

        }).select("_id");

        if (!customerProfile) {

            return {

                page: pageNumber,

                limit: limitNumber,

                totalPayments: 0,

                totalPages: 0,

                payments: []

            };

        }

        filter.customerProfile = customerProfile._id;

    }

    const totalPayments = await Payment.countDocuments(filter);

    const payments = await Payment.find(filter)

        .populate({ path: "customerProfile", select: "user businessName" })

        .populate({ path: "order", select: "orderStatus grandTotal" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort(sort)

        .skip(skip)

        .limit(limitNumber);

    return {

        page: pageNumber,

        limit: limitNumber,

        totalPayments,

        totalPages: Math.ceil(totalPayments / limitNumber),

        payments: buildPaymentList(payments)

    };

};

// ----------------------------
// Get Customer Payments
// ----------------------------

const getCustomerPayments = async (customerProfileId, loggedInUser) => {

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(customerProfileId, loggedInUser);

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findById(customerProfileId);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access these payments.", 403);

        }

    }

    const payments = await Payment.find({ customerProfile: customerProfileId })

        .populate({ path: "order", select: "orderStatus grandTotal paymentStatus" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort({ createdAt: -1 });

    return {

        success: true,

        count: payments.length,

        payments: buildPaymentList(payments)

    };

};

// ----------------------------
// Get Order Payments
// ----------------------------

const getOrderPayments = async (orderId, loggedInUser) => {

    const order = await Order.findById(orderId);

    if (!order) {

        throw new BusinessError("Order not found.", 404);

    }

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(order.customerProfile, loggedInUser);

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findById(order.customerProfile);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access these payments.", 403);

        }

    }

    const payments = await Payment.find({ order: orderId })

        .populate({ path: "createdBy", select: "Name email" })

        .sort({ createdAt: -1 });

    const totals = await calculateOrderOutstanding(orderId);

    return {

        success: true,

        orderId,

        orderGrandTotal: totals.grandTotal,

        totalPaid: totals.totalPaid,

        outstanding: totals.outstanding,

        count: payments.length,

        payments: buildPaymentList(payments)

    };

};

/**
 * Delete a payment entry. Reverses the outstanding + payment status of the
 * parent order and reduces the customer's collected metrics.
 * Admin-only.
 */
const deletePayment = async (paymentId, loggedInUser) => {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
        throw new BusinessError("Payment not found.", 404);
    }

    const orderId = payment.order;
    const amount = payment.amount || 0;

    // Restore outstanding on the order and re-derive paymentStatus
    const order = await Order.findById(orderId);
    if (order) {
        const otherPayments = await Payment.find({ order: orderId, _id: { $ne: paymentId } });
        const totalPaid = otherPayments.reduce((s, p) => s + (p.amount || 0), 0);
        const newOutstanding = roundToTwo(Math.max(0, order.grandTotal - totalPaid));
        if (totalPaid <= 0) order.paymentStatus = "pending";
        else if (newOutstanding <= 0) order.paymentStatus = "paid";
        else order.paymentStatus = "partial";
        await order.save();

        // Restore customer's outstanding total by adding this payment back
        const cp = await CustomerProfile.findById(order.customerProfile);
        if (cp) {
            cp.outstandingAmount = roundToTwo((cp.outstandingAmount || 0) + amount);
            await cp.save();
        }
    }

    await payment.deleteOne();

    // Log activity
    if (order) {
        try {
            await createInternalActivity({
                customerProfileId: order.customerProfile,
                createdBy: loggedInUser._id,
                activityType: "order",
                title: "Payment entry deleted",
                description: `Admin removed a payment of ₹${amount} from Order #${orderId}.`,
                metadata: { orderId, paymentId, amount }
            });
        } catch (_) { /* non-fatal */ }
    }

    return {
        success: true,
        message: "Payment deleted and order/customer totals reversed.",
        removedAmount: amount
    };
};

module.exports = {

    createPayment,

    getPayments,

    getCustomerPayments,

    getOrderPayments,

    calculateOrderOutstanding,

    deletePayment

};
