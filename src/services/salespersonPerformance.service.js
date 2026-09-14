const CustomerProfile = require("../models/customerProfile.model");
const FollowUp = require("../models/followUp.model");
const Quotation = require("../models/quotation.model");
const Order = require("../models/order.model");
const Payment = require("../models/payment.model");
const OrderReturn = require("../models/orderReturn.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildSalespersonPerformance,
    buildSalespersonComparison,
    buildSalespersonComparisonList
} = require("../dto/salespersonPerformance.dto");

const { verifyCustomerOwnership } = require("../helpers/customerOwnership.helper");

// ----------------------------
// Calculation Helpers
// ----------------------------

const roundToTwo = (value) => {
    return Math.round(value * 100) / 100;
};

// ----------------------------
// Get Salesperson Performance
// ----------------------------

const getSalespersonPerformance = async (salespersonId, loggedInUser, query = {}) => {

    if (loggedInUser.role === "salesperson") {

        if (loggedInUser._id.toString() !== salespersonId.toString()) {

            throw new BusinessError("You are not authorized to view this performance.", 403);

        }

    } else if (loggedInUser.role === "manager") {

        const salesperson = await require("../models/user.model").findById(salespersonId);

        if (!salesperson || !salesperson.managerId || salesperson.managerId.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to view this salesperson's performance.", 403);

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
            dateFilter.createdAt.$lte = new Date(endDate);
        }
    }

    // Customers
    const customerFilter = { assignedSalesperson: salespersonId };

    if (startDate || endDate) {
        customerFilter.createdAt = dateFilter.createdAt;
    }

    const assignedCustomers = await CustomerProfile.countDocuments(customerFilter);

    const activeCustomers = await CustomerProfile.countDocuments({

        ...customerFilter,

        customerStage: { $nin: ["new", "lost"] }

    });

    const newCustomers = await CustomerProfile.countDocuments({

        ...customerFilter,

        customerStage: "new"

    });

    // Follow-ups
    const followUpFilter = { salesperson: salespersonId };

    if (startDate || endDate) {
        followUpFilter.createdAt = dateFilter.createdAt;
    }

    const totalFollowUps = await FollowUp.countDocuments(followUpFilter);

    const completedFollowUps = await FollowUp.countDocuments({

        ...followUpFilter,

        status: "completed"

    });

    const pendingFollowUps = await FollowUp.countDocuments({

        ...followUpFilter,

        status: "pending"

    });

    const overdueFollowUps = await FollowUp.countDocuments({

        ...followUpFilter,

        status: "pending",

        followUpDate: { $lt: new Date() }

    });

    // Quotations
    const quotationFilter = { salesperson: salespersonId };

    if (startDate || endDate) {
        quotationFilter.createdAt = dateFilter.createdAt;
    }

    const totalQuotations = await Quotation.countDocuments(quotationFilter);

    const sentQuotations = await Quotation.countDocuments({

        ...quotationFilter,

        status: "sent"

    });

    const acceptedQuotations = await Quotation.countDocuments({

        ...quotationFilter,

        status: "accepted"

    });

    const rejectedQuotations = await Quotation.countDocuments({

        ...quotationFilter,

        status: "rejected"

    });

    const quotationConversionRate = totalQuotations > 0 ?

        roundToTwo((acceptedQuotations / totalQuotations) * 100) : 0;

    // Orders
    const orderFilter = { salesperson: salespersonId };

    if (startDate || endDate) {
        orderFilter.createdAt = dateFilter.createdAt;
    }

    const totalOrders = await Order.countDocuments(orderFilter);

    const completedOrders = await Order.countDocuments({

        ...orderFilter,

        orderStatus: "completed"

    });

    const orders = await Order.find(orderFilter).select("_id grandTotal");

    const grossSales = roundToTwo(orders.reduce((sum, order) => sum + order.grandTotal, 0));

    // Subtract completed returns against this salesperson's orders so the
    // performance number reflects what actually stuck as revenue.
    const orderIds = orders.map((o) => o._id);
    const completedReturns = await OrderReturn.find({
        order: { $in: orderIds },
        status: "completed"
    }).select("items");

    const returnedAmount = roundToTwo(
        completedReturns.reduce(
            (s, r) => s + r.items.reduce((a, i) => a + (i.lineTotal || 0), 0), 0
        )
    );

    const totalSales = roundToTwo(Math.max(0, grossSales - returnedAmount));

    const averageOrderValue = totalOrders > 0 ? roundToTwo(totalSales / totalOrders) : 0;

    // Payments
    const paymentFilter = {};

    if (startDate || endDate) {
        paymentFilter.paymentDate = dateFilter.createdAt;
    }

    const customerProfiles = await CustomerProfile.find({

        assignedSalesperson: salespersonId

    }).select("_id");

    const customerProfileIds = customerProfiles.map(cp => cp._id);

    paymentFilter.customerProfile = { $in: customerProfileIds };

    const payments = await Payment.find(paymentFilter);

    const totalPaymentsCollected = roundToTwo(payments.reduce((sum, p) =>
        sum + (p.type === "refund" ? -p.amount : p.amount), 0));

    const ordersForOutstanding = await Order.find({

        salesperson: salespersonId,

        orderStatus: { $nin: ["cancelled"] }

    }).select("grandTotal paymentStatus");

    const totalOutstandingAmount = roundToTwo(ordersForOutstanding.reduce((sum, order) => {

        if (order.paymentStatus === "paid") return sum;

        return sum + order.grandTotal;

    }, 0));

    // Conversion rate (orders / quotations)
    const orderConversionRate = totalQuotations > 0 ?

        roundToTwo((totalOrders / totalQuotations) * 100) : 0;

    const salesperson = await require("../models/user.model").findById(salespersonId).select("Name");

    const metrics = {

        salespersonId,

        salespersonName: salesperson?.Name || "",

        assignedCustomers,

        activeCustomers,

        newCustomers,

        totalFollowUps,

        completedFollowUps,

        pendingFollowUps,

        overdueFollowUps,

        totalQuotations,

        sentQuotations,

        acceptedQuotations,

        rejectedQuotations,

        quotationConversionRate,

        totalOrders,

        completedOrders,

        grossSales,

        returnedAmount,

        totalSales,

        averageOrderValue,

        totalPaymentsCollected,

        totalOutstandingAmount,

        orderConversionRate

    };

    return buildSalespersonPerformance(metrics);

};

// ----------------------------
// Get Salesperson Comparison
// ----------------------------

const getSalespersonComparison = async (loggedInUser, query = {}) => {

    const { startDate, endDate } = query;

    const dateFilter = {};

    if (startDate || endDate) {
        dateFilter.createdAt = {};

        if (startDate) {
            dateFilter.createdAt.$gte = new Date(startDate);
        }

        if (endDate) {
            dateFilter.createdAt.$lte = new Date(endDate);
        }
    }

    const User = require("../models/user.model");

    let salespersons;

    if (loggedInUser.role === "manager") {

        salespersons = await User.find({

            role: "salesperson",

            managerId: loggedInUser._id,

            status: { $ne: "suspended" }

        }).select("_id Name");

    } else if (loggedInUser.role === "admin") {

        salespersons = await User.find({

            role: "salesperson",

            status: { $ne: "suspended" }

        }).select("_id Name");

    } else {

        throw new BusinessError("You are not authorized to view salesperson comparison.", 403);

    }

    const comparisons = [];

    for (const salesperson of salespersons) {

        const performance = await getSalespersonPerformance(salesperson._id, loggedInUser, query);

        comparisons.push({

            salespersonId: salesperson._id,

            salespersonName: salesperson.Name,

            totalSales: performance.orders.totalSales,

            totalOrders: performance.orders.totalOrders,

            completedOrders: performance.orders.completedOrders,

            totalQuotations: performance.quotations.created,

            acceptedQuotations: performance.quotations.accepted,

            totalFollowUps: performance.followUps.total,

            completedFollowUps: performance.followUps.completed,

            totalPaymentsCollected: performance.payments.collected,

            conversionRate: performance.quotations.conversionRate,

            ranking: 0

        });

    }

    comparisons.sort((a, b) => b.totalSales - a.totalSales);

    comparisons.forEach((comparison, index) => {

        comparison.ranking = index + 1;

    });

    return buildSalespersonComparisonList(comparisons);

};

module.exports = {

    getSalespersonPerformance,

    getSalespersonComparison

};
