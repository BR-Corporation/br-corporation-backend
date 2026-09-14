const CustomerProfile = require("../models/customerProfile.model");
const FollowUp = require("../models/followUp.model");
const Quotation = require("../models/quotation.model");
const Order = require("../models/order.model");
const Payment = require("../models/payment.model");
const BusinessError = require("../utils/errors/businessError");

const { verifyCustomerOwnership } = require("../helpers/customerOwnership.helper");

const roundToTwo = (value) => {
    return Math.round(value * 100) / 100;
};

const getSalespersonDashboard = async (salespersonId, loggedInUser, query = {}) => {

    if (loggedInUser.role === "salesperson") {

        if (loggedInUser._id.toString() !== salespersonId.toString()) {

            throw new BusinessError("You are not authorized to view this dashboard.", 403);

        }

    }

    const { startDate, endDate } = query;

    const dateFilter = {};

    if (startDate || endDate) {
        dateFilter.createdAt = {};

        if (startDate) {
            dateFilter.createdAt.$gte = new Date(startDate);
        }

        if (endDate) {
            dateFilter.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
        }
    }

    const customerFilter = { assignedSalesperson: salespersonId };

    if (startDate || endDate) {
        customerFilter.createdAt = dateFilter.createdAt;
    }

    const totalCustomers = await CustomerProfile.countDocuments(customerFilter);

    const newCustomers = await CustomerProfile.countDocuments({

        ...customerFilter,

        customerStage: "new"

    });

    const activeCustomers = await CustomerProfile.countDocuments({

        ...customerFilter,

        customerStage: { $nin: ["new", "lost"] }

    });

    const quotationFilter = { salesperson: salespersonId };

    if (startDate || endDate) {
        quotationFilter.createdAt = dateFilter.createdAt;
    }

    const totalQuotations = await Quotation.countDocuments(quotationFilter);

    const acceptedQuotations = await Quotation.countDocuments({

        ...quotationFilter,

        status: "accepted"

    });

    const quotationConversionRate = totalQuotations > 0 ?
        roundToTwo((acceptedQuotations / totalQuotations) * 100) : 0;

    const orderFilter = { salesperson: salespersonId };

    if (startDate || endDate) {
        orderFilter.createdAt = dateFilter.createdAt;
    }

    const totalOrders = await Order.countDocuments(orderFilter);

    const completedOrders = await Order.countDocuments({

        ...orderFilter,

        orderStatus: "completed"

    });

    const orders = await Order.find(orderFilter).select("grandTotal");

    const totalSales = roundToTwo(orders.reduce((sum, order) => sum + order.grandTotal, 0));

    const averageOrderValue = totalOrders > 0 ? roundToTwo(totalSales / totalOrders) : 0;

    const customerProfiles = await CustomerProfile.find({

        assignedSalesperson: salespersonId

    }).select("_id");

    const customerProfileIds = customerProfiles.map(cp => cp._id);

    const paymentFilter = { customerProfile: { $in: customerProfileIds } };

    if (startDate || endDate) {
        paymentFilter.paymentDate = dateFilter.createdAt;
    }

    const payments = await Payment.find(paymentFilter);

    const totalPaymentsCollected = roundToTwo(payments.reduce((sum, payment) => sum + payment.amount, 0));

    const ordersForOutstanding = await Order.find({

        salesperson: salespersonId,

        orderStatus: { $nin: ["cancelled"] }

    }).select("_id grandTotal paymentStatus orderStatus");

    const outIds = ordersForOutstanding.map((o) => o._id);
    const outPayments = outIds.length
        ? await Payment.find({ order: { $in: outIds } }).select("order amount type")
        : [];
    const netByOrderOut = new Map();
    for (const p of outPayments) {
        const k = p.order.toString();
        netByOrderOut.set(k, (netByOrderOut.get(k) || 0) + (p.type === "refund" ? -p.amount : p.amount));
    }

    const totalOutstandingAmount = roundToTwo(ordersForOutstanding.reduce((sum, order) => {
        if (order.paymentStatus === "paid") return sum;
        const netPaid = netByOrderOut.get(order._id.toString()) || 0;
        const remaining = order.grandTotal - netPaid;
        return sum + (remaining > 0 ? remaining : 0);
    }, 0));

    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);

    tomorrow.setDate(tomorrow.getDate() + 1);

    const followUpFilter = { customerProfile: { $in: customerProfileIds } };

    if (startDate || endDate) {
        followUpFilter.createdAt = dateFilter.createdAt;
    }

    const totalFollowUps = await FollowUp.countDocuments(followUpFilter);

    const completedFollowUps = await FollowUp.countDocuments({

        ...followUpFilter,

        status: "completed"

    });

    const overdueFollowUps = await FollowUp.countDocuments({

        ...followUpFilter,

        status: "pending",

        followUpDate: { $lt: today }

    });

    const pendingFollowUps = await FollowUp.countDocuments({

        ...followUpFilter,

        status: "pending"

    });

    const dashboard = {

        crm: {

            totalCustomers,

            newCustomers,

            activeCustomers,

            followUpCompletionRate: totalFollowUps > 0 ?
                roundToTwo((completedFollowUps / totalFollowUps) * 100) : 0,

            overdueFollowUps

        },

        quotations: {

            created: totalQuotations,

            accepted: acceptedQuotations,

            rejected: await Quotation.countDocuments({

                ...quotationFilter,

                status: "rejected"

            }),

            conversionRate: quotationConversionRate

        },

        orders: {

            created: totalOrders,

            completed: completedOrders,

            totalSales,

            averageOrderValue

        },

        payments: {

            collected: totalPaymentsCollected,

            outstanding: totalOutstandingAmount,

            overdue: ordersForOutstanding.filter(o => o.paymentStatus !== "paid" && o.orderStatus !== "completed").length

        },

        followUps: {

            total: totalFollowUps,

            completed: completedFollowUps,

            pending: pendingFollowUps,

            overdue: overdueFollowUps

        },

        performance: {

            conversionRate: totalQuotations > 0 ?
                roundToTwo((totalOrders / totalQuotations) * 100) : 0

        }

    };

    return dashboard;

};

module.exports = {

    getSalespersonDashboard

};
