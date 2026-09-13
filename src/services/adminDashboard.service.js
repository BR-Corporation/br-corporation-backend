const CustomerProfile = require("../models/customerProfile.model");
const User = require("../models/user.model");
const FollowUp = require("../models/followUp.model");
const Quotation = require("../models/quotation.model");
const Order = require("../models/order.model");
const Payment = require("../models/payment.model");
const Product = require("../models/product.model");
const InventoryMovement = require("../models/inventoryMovement.model");
const OrderReturn = require("../models/orderReturn.model");
const BusinessError = require("../utils/errors/businessError");

const { buildAdminDashboard } = require("../dto/adminDashboard.dto");
const { getSalespersonPerformance } = require("../services/salespersonPerformance.service");

const roundToTwo = (value) => {
    return Math.round(value * 100) / 100;
};

// ----------------------------
// Get Admin Dashboard
// ----------------------------

const getAdminDashboard = async (loggedInUser, query = {}) => {

    if (loggedInUser.role !== "admin") {

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
            dateFilter.createdAt.$lte = new Date(endDate);
        }
    }

    // ----------------------------
    // Customer Metrics
    // ----------------------------

    const customerFilter = {};

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

    const pendingCustomers = await User.countDocuments({

        role: "customer",

        status: "pending"

    });

    // Customers by stage
    const customersByStage = await CustomerProfile.aggregate([

        { $group: { _id: "$customerStage", count: { $sum: 1 } } },

        { $sort: { count: -1 } }

    ]);

    // Customers by city
    const customersByCity = await CustomerProfile.aggregate([

        { $group: { _id: "$city", count: { $sum: 1 } } },

        { $sort: { count: -1 } },

        { $limit: 10 }

    ]);

    // ----------------------------
    // Sales Metrics
    // ----------------------------

    const orderFilter = { orderStatus: { $nin: ["cancelled"] } };

    if (startDate || endDate) {
        orderFilter.createdAt = dateFilter.createdAt;
    }

    const totalOrders = await Order.countDocuments(orderFilter);

    const orders = await Order.find(orderFilter).select("grandTotal createdAt");

    const totalSales = roundToTwo(orders.reduce((sum, order) => sum + order.grandTotal, 0));

    const averageOrderValue = totalOrders > 0 ? roundToTwo(totalSales / totalOrders) : 0;

    // Daily sales
    const dailySales = await Order.aggregate([

        { $match: orderFilter },

        {

            $group: {

                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },

                sales: { $sum: "$grandTotal" },

                orders: { $sum: 1 }

            }

        },

        { $sort: { _id: -1 } },

        { $limit: 30 }

    ]);

    // Monthly sales
    const monthlySales = await Order.aggregate([

        { $match: orderFilter },

        {

            $group: {

                _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },

                sales: { $sum: "$grandTotal" },

                orders: { $sum: 1 }

            }

        },

        { $sort: { _id: -1 } },

        { $limit: 12 }

    ]);

    // Sales trends (last 7 days)
    const salesTrends = await Order.aggregate([

        { $match: orderFilter },

        {

            $group: {

                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },

                sales: { $sum: "$grandTotal" }

            }

        },

        { $sort: { _id: -1 } },

        { $limit: 7 }

    ]);

    // ----------------------------
    // Salesperson Performance
    // ----------------------------

    const salespersons = await User.find({ role: "salesperson" }).select("_id Name");

    const salespersonRanking = [];

    for (const salesperson of salespersons) {

        const performance = await getSalespersonPerformance(salesperson._id, loggedInUser, query);

        salespersonRanking.push({

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

    salespersonRanking.sort((a, b) => b.totalSales - a.totalSales);

    // ----------------------------
    // Manager Performance
    // ----------------------------

    const managers = await User.find({ role: "manager" }).select("_id Name");

    const managerTeamPerformance = [];

    for (const manager of managers) {

        const teamSalespersons = await User.find({

            role: "salesperson",

            managerId: manager._id

        }).select("_id");

        const teamSalespersonIds = teamSalespersons.map(sp => sp._id);

        const teamOrders = await Order.find({

            salesperson: { $in: teamSalespersonIds },

            orderStatus: { $nin: ["cancelled"] }

        }).select("grandTotal");

        const teamSales = roundToTwo(teamOrders.reduce((sum, o) => sum + o.grandTotal, 0));

        const teamQuotations = await Quotation.countDocuments({

            salesperson: { $in: teamSalespersonIds }

        });

        const teamAcceptedQuotations = await Quotation.countDocuments({

            salesperson: { $in: teamSalespersonIds },

            status: "accepted"

        });

        const teamConversionRate = teamQuotations > 0 ?

            roundToTwo((teamAcceptedQuotations / teamQuotations) * 100) : 0;

        managerTeamPerformance.push({

            managerId: manager._id,

            managerName: manager.Name,

            teamSales,

            teamOrders: teamOrders.length,

            teamQuotations,

            teamAcceptedQuotations,

            teamConversionRate,

            salespersonCount: teamSalespersons.length

        });

    }

    // ----------------------------
    // Inventory Metrics
    // ----------------------------

    const totalProducts = await Product.countDocuments({});

    const lowStockProducts = await Product.countDocuments({

        stock: { $gt: 0, $lte: 10 }

    });

    const outOfStockProducts = await Product.countDocuments({

        stock: 0

    });

    const stockMovements = await InventoryMovement.countDocuments({});

    // Best-selling products
    const bestSellingProducts = await Order.aggregate([

        { $match: { orderStatus: { $nin: ["cancelled"] } } },

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
    // Finance Metrics
    // ----------------------------

    const completedReturns = await OrderReturn.find({ status: "completed" }).select("items");

    const returnedAmount = roundToTwo(
        completedReturns.reduce((sum, r) => sum + r.items.reduce((s, i) => s + (i.lineTotal || 0), 0), 0)
    );

    const totalRevenue = roundToTwo(Math.max(0, totalSales - returnedAmount));

    const paymentFilter = {};

    if (startDate || endDate) {
        paymentFilter.paymentDate = dateFilter.createdAt;
    }

    const payments = await Payment.find(paymentFilter);

    const paymentsCollected = roundToTwo(payments.reduce((sum, p) =>
        sum + (p.type === "refund" ? -p.amount : p.amount), 0));

    const refundsIssued = roundToTwo(payments.reduce((sum, p) =>
        sum + (p.type === "refund" ? p.amount : 0), 0));

    const allOrders = await Order.find({ orderStatus: { $nin: ["cancelled"] } }).select("grandTotal paymentStatus");

    const outstandingAmount = roundToTwo(allOrders.reduce((sum, order) => {

        if (order.paymentStatus === "paid") return sum;

        return sum + order.grandTotal;

    }, 0));

    const overduePayments = await Order.countDocuments({

        orderStatus: { $nin: ["cancelled", "completed"] },

        paymentStatus: { $in: ["pending", "partial"] }

    });

    // ----------------------------
    // Quotation Metrics
    // ----------------------------

    const quotationFilter = {};

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

    // ----------------------------
    // Customer CRM Metrics
    // ----------------------------

    const totalFollowUps = await FollowUp.countDocuments({});

    const overdueFollowUps = await FollowUp.countDocuments({

        status: "pending",

        followUpDate: { $lt: new Date() }

    });

    const customerStageDistribution = await CustomerProfile.aggregate([

        { $group: { _id: "$customerStage", count: { $sum: 1 } } },

        { $sort: { count: -1 } }

    ]);

    const dashboard = {

        totalCustomers,

        newCustomers,

        activeCustomers,

        pendingCustomers,

        customersByStage,

        customersByCity,

        totalSales,

        dailySales,

        monthlySales,

        salesTrends,

        totalOrders,

        averageOrderValue,

        salespersonRanking,

        managerTeamPerformance,

        totalProducts,

        lowStockProducts,

        outOfStockProducts,

        stockMovements,

        bestSellingProducts,

        totalRevenue,

        totalSales,

        returnedAmount,

        refundsIssued,

        refundPending: roundToTwo(Math.max(0, returnedAmount - refundsIssued)),

        paymentsCollected,

        outstandingAmount,

        overduePayments,

        totalQuotations,

        sentQuotations,

        acceptedQuotations,

        rejectedQuotations,

        quotationConversionRate,

        totalFollowUps,

        overdueFollowUps,

        customerStageDistribution

    };

    return buildAdminDashboard(dashboard);

};

module.exports = {

    getAdminDashboard

};
