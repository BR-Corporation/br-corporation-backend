const User = require("../models/user.model");
const CustomerProfile = require("../models/customerProfile.model");
const FollowUp = require("../models/followUp.model");
const Quotation = require("../models/quotation.model");
const Order = require("../models/order.model");
const Payment = require("../models/payment.model");
const Product = require("../models/product.model");
const BusinessError = require("../utils/errors/businessError");

const { buildManagerDashboard } = require("../dto/managerDashboard.dto");
const { getSalespersonPerformance } = require("../services/salespersonPerformance.service");

const roundToTwo = (value) => {
    return Math.round(value * 100) / 100;
};

// ----------------------------
// Get Manager Dashboard
// ----------------------------

const getManagerDashboard = async (managerId, loggedInUser, query = {}) => {

    if (loggedInUser._id.toString() !== managerId.toString()) {

        throw new BusinessError("You are not authorized to view this dashboard.", 403);

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

    // Get all salespersons assigned to this manager
    const salespersonFilter = { role: "salesperson" };

    if (loggedInUser.role === "manager") {

        salespersonFilter.managerId = managerId;

    }

    const salespersons = await User.find(salespersonFilter).select("_id Name");

    const salespersonIds = salespersons.map(sp => sp._id);

    // ----------------------------
    // CRM Metrics
    // ----------------------------

    const customerFilter = { assignedSalesperson: { $in: salespersonIds } };

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

    // ----------------------------
    // Follow-up Metrics
    // ----------------------------

    const followUpFilter = { salesperson: { $in: salespersonIds } };

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

        followUpDate: { $lt: new Date() }

    });

    const followUpCompletionRate = totalFollowUps > 0 ?

        roundToTwo((completedFollowUps / totalFollowUps) * 100) : 0;

    // ----------------------------
    // Quotation Metrics
    // ----------------------------

    const quotationFilter = { salesperson: { $in: salespersonIds } };

    if (startDate || endDate) {
        quotationFilter.createdAt = dateFilter.createdAt;
    }

    const totalQuotations = await Quotation.countDocuments(quotationFilter);

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

    // ----------------------------
    // Order Metrics
    // ----------------------------

    const orderFilter = { salesperson: { $in: salespersonIds } };

    if (startDate || endDate) {
        orderFilter.createdAt = dateFilter.createdAt;
    }

    const totalOrders = await Order.countDocuments(orderFilter);

    const completedOrders = await Order.countDocuments({

        ...orderFilter,

        orderStatus: "completed"

    });

    const orders = await Order.find(orderFilter).select("grandTotal salesperson");

    const teamSales = roundToTwo(orders.reduce((sum, order) => sum + order.grandTotal, 0));

    const averageOrderValue = totalOrders > 0 ? roundToTwo(teamSales / totalOrders) : 0;

    // Sales by salesperson
    const salesBySalesperson = [];

    for (const salesperson of salespersons) {

        const salespersonOrders = orders.filter(o => o.salesperson.toString() === salesperson._id.toString());

        const salespersonSales = roundToTwo(salespersonOrders.reduce((sum, o) => sum + o.grandTotal, 0));

        salesBySalesperson.push({

            salespersonId: salesperson._id,

            salespersonName: salesperson.Name,

            totalSales: salespersonSales,

            orderCount: salespersonOrders.length

        });

    }

    // ----------------------------
    // Payment Metrics
    // ----------------------------

    const paymentFilter = {};

    if (startDate || endDate) {
        paymentFilter.paymentDate = dateFilter.createdAt;
    }

    const customerProfiles = await CustomerProfile.find({

        assignedSalesperson: { $in: salespersonIds }

    }).select("_id");

    const customerProfileIds = customerProfiles.map(cp => cp._id);

    paymentFilter.customerProfile = { $in: customerProfileIds };

    const payments = await Payment.find(paymentFilter);

    const totalPaymentsCollected = roundToTwo(payments.reduce((sum, p) => sum + p.amount, 0));

    const teamOrders = await Order.find({

        salesperson: { $in: salespersonIds },

        orderStatus: { $nin: ["cancelled"] }

    }).select("_id grandTotal paymentStatus");

    const teamOrderIds = teamOrders.map((o) => o._id);
    const teamPayments = teamOrderIds.length
        ? await Payment.find({ order: { $in: teamOrderIds } }).select("order amount type")
        : [];
    const netByTeamOrder = new Map();
    for (const p of teamPayments) {
        const k = p.order.toString();
        netByTeamOrder.set(k, (netByTeamOrder.get(k) || 0) + (p.type === "refund" ? -p.amount : p.amount));
    }

    const totalOutstandingAmount = roundToTwo(teamOrders.reduce((sum, order) => {
        if (order.paymentStatus === "paid") return sum;
        const netPaid = netByTeamOrder.get(order._id.toString()) || 0;
        const remaining = order.grandTotal - netPaid;
        return sum + (remaining > 0 ? remaining : 0);
    }, 0));

    // ----------------------------
    // Inventory Metrics
    // ----------------------------

    const lowStockProducts = await Product.countDocuments({

        stock: { $gt: 0 },

        $expr: { $lte: ["$stock", "$minimumStock"] }

    });

    const outOfStockProducts = await Product.countDocuments({

        stock: 0

    });

    // Best-selling products (from order items)
    const bestSellingProducts = await Order.aggregate([

        { $match: { salesperson: { $in: salespersonIds } } },

        { $unwind: "$items" },

        {

            $group: {

                _id: "$items.product",

                totalQuantity: { $sum: "$items.quantity" },

                totalRevenue: { $sum: "$items.lineTotal" }

            }

        },

        { $sort: { totalQuantity: -1 } },

        { $limit: 5 },

        {

            $lookup: {

                from: "products",

                localField: "_id",

                foreignField: "_id",

                as: "product"

            }

        },

        { $unwind: "$product" },

        {

            $project: {

                productId: "$_id",

                productName: "$product.name",

                totalQuantity: 1,

                totalRevenue: 1

            }

        }

    ]);

    // ----------------------------
    // Performance Metrics
    // ----------------------------

    let topSalesperson = null;
    let lowestPerformingSalesperson = null;

    const salespersonComparisons = [];

    for (const salesperson of salespersons) {

        const performance = await getSalespersonPerformance(salesperson._id, loggedInUser, query);

        salespersonComparisons.push({

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

            conversionRate: performance.quotations.conversionRate

        });

    }

    salespersonComparisons.sort((a, b) => b.totalSales - a.totalSales);

    if (salespersonComparisons.length > 0) {

        topSalesperson = salespersonComparisons[0];

        lowestPerformingSalesperson = salespersonComparisons[salespersonComparisons.length - 1];

    }

    const dashboard = {

        teamSales,

        totalOrders,

        completedOrders,

        averageOrderValue,

        salesBySalesperson,

        totalCustomers,

        newCustomers,

        activeCustomers,

        followUpCompletionRate,

        overdueFollowUps,

        totalQuotations,

        acceptedQuotations,

        rejectedQuotations,

        quotationConversionRate,

        totalPaymentsCollected,

        totalOutstandingAmount,

        lowStockProducts,

        outOfStockProducts,

        bestSellingProducts,

        topSalesperson,

        lowestPerformingSalesperson,

        salespersonComparison: salespersonComparisons

    };

    return buildManagerDashboard(dashboard);

};

module.exports = {

    getManagerDashboard

};
