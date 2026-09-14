const CustomerProfile = require("../models/customerProfile.model");
const OrderReturn = require("../models/orderReturn.model");
const User = require("../models/user.model");
const Quotation = require("../models/quotation.model");
const Order = require("../models/order.model");
const OrderItem = require("../models/order.model");
const Payment = require("../models/payment.model");
const Product = require("../models/product.model");
const InventoryMovement = require("../models/inventoryMovement.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildSalesReport,
    buildCustomerReport,
    buildProductReport,
    buildInventoryReport,
    buildPaymentReport,
    buildSalespersonReport,
    buildManagerReport
} = require("../dto/report.dto");

const roundToTwo = (value) => {
    return Math.round(value * 100) / 100;
};

// ----------------------------
// Sales Report
// ----------------------------

const getSalesReport = async (loggedInUser, query = {}) => {

    const { startDate, endDate, salesperson, customer, orderStatus } = query;

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

    const orderFilter = { orderStatus: { $nin: ["cancelled"] } };

    if (startDate || endDate) {
        orderFilter.createdAt = dateFilter.createdAt;
    }

    if (salesperson) {
        orderFilter.salesperson = salesperson;
    }

    if (customer) {
        orderFilter.customerProfile = customer;
    }

    if (orderStatus) {
        orderFilter.orderStatus = orderStatus;
    }

    const orders = await Order.find(orderFilter)
        .populate({ path: "salesperson", select: "Name" })
        .populate({ path: "customerProfile", select: "businessName" })
        .select("grandTotal createdAt salesperson customerProfile");

    const totalSales = roundToTwo(orders.reduce((sum, o) => sum + o.grandTotal, 0));

    const totalOrders = orders.length;

    const averageOrderValue = totalOrders > 0 ? roundToTwo(totalSales / totalOrders) : 0;

    // Completed returns against the orders in scope — filter by order id
    // so a date range on the sales report also constrains returns.
    const orderIds = orders.map((o) => o._id);
    const completedReturns = await OrderReturn.find({
        order: { $in: orderIds },
        status: "completed"
    }).select("items order");

    const returnedAmount = roundToTwo(
        completedReturns.reduce((s, r) => s + r.items.reduce((a, i) => a + (i.lineTotal || 0), 0), 0)
    );

    const totalRevenue = roundToTwo(Math.max(0, totalSales - returnedAmount));

    // Per-order refunded amount for salesperson / customer / product aggregation
    const returnedByOrder = new Map();
    for (const r of completedReturns) {
        const oid = r.order.toString();
        const amt = r.items.reduce((a, i) => a + (i.lineTotal || 0), 0);
        returnedByOrder.set(oid, (returnedByOrder.get(oid) || 0) + amt);
    }

    // Sales by date
    const salesByDate = await Order.aggregate([

        { $match: orderFilter },

        {

            $group: {

                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },

                sales: { $sum: "$grandTotal" },

                orders: { $sum: 1 }

            }

        },

        { $sort: { _id: -1 } }

    ]);

    // Sales by salesperson
    const salesBySalesperson = await Order.aggregate([

        { $match: orderFilter },

        {

            $group: {

                _id: "$salesperson",

                sales: { $sum: "$grandTotal" },

                orders: { $sum: 1 }

            }

        },

        { $sort: { sales: -1 } },

        {

            $lookup: {

                from: "users",

                localField: "_id",

                foreignField: "_id",

                as: "salesperson"

            }

        },

        { $unwind: "$salesperson" },

        {

            $project: {

                salespersonId: "$_id",

                salespersonName: "$salesperson.Name",

                sales: 1,

                orders: 1

            }

        }

    ]);

    // Sales by customer
    const salesByCustomer = await Order.aggregate([

        { $match: orderFilter },

        {

            $group: {

                _id: "$customerProfile",

                sales: { $sum: "$grandTotal" },

                orders: { $sum: 1 }

            }

        },

        { $sort: { sales: -1 } },

        {

            $lookup: {

                from: "customerprofiles",

                localField: "_id",

                foreignField: "_id",

                as: "customer"

            }

        },

        { $unwind: "$customer" },

        {

            $project: {

                customerId: "$_id",

                customerName: "$customer.businessName",

                sales: 1,

                orders: 1

            }

        }

    ]);

    // Sales by product
    const salesByProduct = await Order.aggregate([

        { $match: orderFilter },

        { $unwind: "$items" },

        {

            $group: {

                _id: "$items.product",

                quantity: { $sum: "$items.quantity" },

                revenue: { $sum: "$items.lineTotal" }

            }

        },

        { $sort: { revenue: -1 } },

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

                quantity: 1,

                revenue: 1

            }

        }

    ]);

    return buildSalesReport({

        totalSales,

        totalRevenue,

        returnedAmount,

        totalOrders,

        averageOrderValue,

        salesByDate,

        salesBySalesperson,

        salesByManager: [],

        salesByCustomer,

        salesByProduct

    });

};

// ----------------------------
// Customer Report
// ----------------------------

const getCustomerReport = async (loggedInUser, query = {}) => {

    const { stage, city, salesperson } = query;

    const filter = {};

    if (stage) {
        filter.customerStage = stage;
    }

    if (city) {
        filter.city = city;
    }

    if (salesperson) {
        filter.assignedSalesperson = salesperson;
    }

    if (loggedInUser.role === "salesperson") {
        filter.assignedSalesperson = loggedInUser._id;
    }

    const customers = await CustomerProfile.find(filter)
        .populate({ path: "assignedSalesperson", select: "Name" })
        .populate({ path: "user", select: "Name phoneNumber" })
        .select("businessName customerStage totalOrders totalRevenue outstandingAmount assignedSalesperson")
        .sort({ createdAt: -1 });

    const totalCustomers = customers.length;

    const reportCustomers = customers.map(c => ({

        id: c._id,

        businessName: c.businessName,

        customerStage: c.customerStage,

        assignedSalesperson: c.assignedSalesperson ? {

            id: c.assignedSalesperson._id,

            Name: c.assignedSalesperson.Name

        } : null,

        totalOrders: c.totalOrders,

        totalRevenue: c.totalRevenue,

        outstandingAmount: c.outstandingAmount

    }));

    return buildCustomerReport({

        totalCustomers,

        customers: reportCustomers

    });

};

// ----------------------------
// Product Report
// ----------------------------

const getProductReport = async (loggedInUser, query = {}) => {

    const products = await Product.find({}).select("name SKU stock sellingPrice costPrice minimumStock");

    const totalProducts = products.length;

    const reportProducts = products.map(p => ({

        id: p._id,

        name: p.name,

        SKU: p.SKU,

        stock: p.stock,

        sellingPrice: p.sellingPrice,

        costPrice: p.costPrice,

        minimumStock: p.minimumStock

    }));

    return buildProductReport({

        totalProducts,

        products: reportProducts

    });

};

// ----------------------------
// Inventory Report
// ----------------------------

const getInventoryReport = async (loggedInUser, query = {}) => {

    const totalProducts = await Product.countDocuments({});

    // Low stock = stock <= product's own minimumStock (per-product threshold),
    // matching how the inventory page and low_stock notifications compute it.
    const lowStockProducts = await Product.find({
        stock: { $gt: 0 },
        $expr: { $lte: ["$stock", "$minimumStock"] }
    })
        .select("name SKU stock minimumStock")
        .sort({ stock: 1 });

    const outOfStockProducts = await Product.find({ stock: 0 })
        .select("name SKU stock minimumStock")
        .sort({ name: 1 });

    const inventoryMovements = await InventoryMovement.find({})
        .populate({ path: "product", select: "name SKU" })
        .populate({ path: "performedBy", select: "Name" })
        .select("type quantity previousStock newStock reason createdAt")
        .sort({ createdAt: -1 })
        .limit(100);

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

        { $limit: 10 },

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

                SKU: "$product.SKU",

                totalQuantity: 1,

                totalRevenue: 1

            }

        }

    ]);

    return buildInventoryReport({

        totalProducts,

        lowStockProducts,

        outOfStockProducts,

        inventoryMovements,

        bestSellingProducts

    });

};

// ----------------------------
// Payment Report
// ----------------------------

const getPaymentReport = async (loggedInUser, query = {}) => {

    const { startDate, endDate, customer, order } = query;

    const filter = {};

    if (startDate || endDate) {
        filter.paymentDate = {};

        if (startDate) {
            filter.paymentDate.$gte = new Date(startDate);
        }

        if (endDate) {
            filter.paymentDate.$lte = new Date(endDate);
        }
    }

    if (customer) {
        filter.customerProfile = customer;
    }

    if (order) {
        filter.order = order;
    }

    if (loggedInUser.role === "salesperson") {

        const customerProfiles = await CustomerProfile.find({

            assignedSalesperson: loggedInUser._id

        }).select("_id");

        filter.customerProfile = { $in: customerProfiles.map(cp => cp._id) };

    }

    const payments = await Payment.find(filter)
        .populate({ path: "customerProfile", select: "businessName" })
        .populate({ path: "order", select: "orderStatus grandTotal" })
        .populate({ path: "createdBy", select: "Name" })
        .select("amount paymentMethod paymentDate transactionReference")
        .sort({ paymentDate: -1 });

    const totalPayments = payments.length;

    const totalCollected = roundToTwo(payments.reduce((sum, p) => sum + p.amount, 0));

    const orderFilter = { orderStatus: { $nin: ["cancelled"] } };

    if (loggedInUser.role === "salesperson") {

        const customerProfiles = await CustomerProfile.find({

            assignedSalesperson: loggedInUser._id

        }).select("_id");

        orderFilter.customerProfile = { $in: customerProfiles.map(cp => cp._id) };

    }

    const orders = await Order.find(orderFilter).select("grandTotal paymentStatus");

    const totalOutstanding = roundToTwo(orders.reduce((sum, o) => {

        if (o.paymentStatus === "paid") return sum;

        return sum + o.grandTotal;

    }, 0));

    const overduePayments = orders.filter(o => o.paymentStatus !== "paid" && o.orderStatus !== "completed").length;

    const reportPayments = payments.map(p => ({

        id: p._id,

        amount: p.amount,

        paymentMethod: p.paymentMethod,

        paymentDate: p.paymentDate,

        transactionReference: p.transactionReference,

        customer: p.customerProfile ? p.customerProfile.businessName : null,

        order: p.order ? {

            id: p.order._id,

            orderStatus: p.order.orderStatus,

            grandTotal: p.order.grandTotal

        } : null

    }));

    return buildPaymentReport({

        totalPayments,

        totalCollected,

        totalOutstanding,

        overduePayments,

        payments: reportPayments

    });

};

// ----------------------------
// Salesperson Report
// ----------------------------

const getSalespersonReport = async (salespersonId, loggedInUser, query = {}) => {

    if (loggedInUser.role === "salesperson") {

        if (loggedInUser._id.toString() !== salespersonId.toString()) {

            throw new BusinessError("You are not authorized to view this report.", 403);

        }

    } else if (loggedInUser.role === "manager") {

        const salesperson = await User.findById(salespersonId);

        if (!salesperson || !salesperson.managerId || salesperson.managerId.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to view this report.", 403);

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

    const salesperson = await User.findById(salespersonId).select("Name");

    // Customers
    const customerFilter = { assignedSalesperson: salespersonId };

    if (startDate || endDate) {
        customerFilter.createdAt = dateFilter.createdAt;
    }

    const customers = await CustomerProfile.countDocuments(customerFilter);

    // Quotations
    const quotationFilter = { salesperson: salespersonId };

    if (startDate || endDate) {
        quotationFilter.createdAt = dateFilter.createdAt;
    }

    const quotations = await Quotation.countDocuments(quotationFilter);

    // Orders
    const orderFilter = { salesperson: salespersonId };

    if (startDate || endDate) {
        orderFilter.createdAt = dateFilter.createdAt;
    }

    const orders = await Order.find(orderFilter).select("grandTotal");

    const sales = roundToTwo(orders.reduce((sum, o) => sum + o.grandTotal, 0));

    // Payments
    const paymentFilter = {};

    if (startDate || endDate) {
        paymentFilter.paymentDate = dateFilter.createdAt;
    }

    const customerProfiles = await CustomerProfile.find({

        assignedSalesperson: salespersonId

    }).select("_id");

    paymentFilter.customerProfile = { $in: customerProfiles.map(cp => cp._id) };

    const payments = await Payment.find(paymentFilter);

    const collections = roundToTwo(payments.reduce((sum, p) => sum + p.amount, 0));

    // Conversion rate
    const acceptedQuotations = await Quotation.countDocuments({

        ...quotationFilter,

        status: "accepted"

    });

    const conversionRate = quotations > 0 ? roundToTwo((acceptedQuotations / quotations) * 100) : 0;

    return buildSalespersonReport({

        salespersonId,

        salespersonName: salesperson?.Name || "",

        customers,

        quotations,

        orders: orders.length,

        sales,

        collections,

        conversionRate

    });

};

// ----------------------------
// Manager Report
// ----------------------------

const getManagerReport = async (managerId, loggedInUser, query = {}) => {

    if (loggedInUser._id.toString() !== managerId.toString()) {

        throw new BusinessError("You are not authorized to view this report.", 403);

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

    const manager = await User.findById(managerId).select("Name");

    const salespersons = await User.find({

        role: "salesperson",

        managerId: managerId

    }).select("_id Name");

    const salespersonIds = salespersons.map(sp => sp._id);

    // Team sales
    const orderFilter = { salesperson: { $in: salespersonIds } };

    if (startDate || endDate) {
        orderFilter.createdAt = dateFilter.createdAt;
    }

    const orders = await Order.find(orderFilter).select("grandTotal");

    const teamSales = roundToTwo(orders.reduce((sum, o) => sum + o.grandTotal, 0));

    const teamOrders = orders.length;

    // Team quotations
    const quotationFilter = { salesperson: { $in: salespersonIds } };

    if (startDate || endDate) {
        quotationFilter.createdAt = dateFilter.createdAt;
    }

    const teamQuotations = await Quotation.countDocuments(quotationFilter);

    const teamAcceptedQuotations = await Quotation.countDocuments({

        ...quotationFilter,

        status: "accepted"

    });

    // Team collections
    const paymentFilter = {};

    if (startDate || endDate) {
        paymentFilter.paymentDate = dateFilter.createdAt;
    }

    const customerProfiles = await CustomerProfile.find({

        assignedSalesperson: { $in: salespersonIds }

    }).select("_id");

    paymentFilter.customerProfile = { $in: customerProfiles.map(cp => cp._id) };

    const payments = await Payment.find(paymentFilter);

    const teamCollections = roundToTwo(payments.reduce((sum, p) => sum + p.amount, 0));

    const teamConversionRate = teamQuotations > 0 ?

        roundToTwo((teamAcceptedQuotations / teamQuotations) * 100) : 0;

    const salespersonReports = [];

    for (const salesperson of salespersons) {

        const report = await getSalespersonReport(salesperson._id, loggedInUser, query);

        salespersonReports.push(report);

    }

    return buildManagerReport({

        managerId,

        managerName: manager?.Name || "",

        teamSales,

        teamOrders,

        teamQuotations,

        teamCollections,

        teamConversionRate,

        salespersonReports

    });

};

module.exports = {

    getSalesReport,

    getCustomerReport,

    getProductReport,

    getInventoryReport,

    getPaymentReport,

    getSalespersonReport,

    getManagerReport

};
