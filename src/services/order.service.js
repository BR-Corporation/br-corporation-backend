const Order = require("../models/order.model");
const Product = require("../models/product.model");
const CustomerProfile = require("../models/customerProfile.model");
const Quotation = require("../models/quotation.model");
const InventoryMovement = require("../models/inventoryMovement.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildOrderDetail,
    buildOrderSummary,
    buildOrderList
} = require("../dto/order.dto");

const { verifyCustomerOwnership } = require("../helpers/customerOwnership.helper");
const {
    createInternalActivity
} = require("./customerActivity.service");

const {
    createNotification
} = require("./notification.service");

const {
    deleteProductImage
} = require("./product.service");

const fs = require("fs");
const path = require("path");

// ----------------------------
// Calculation Helpers
// ----------------------------

const roundToTwo = (value) => {
    return Math.round(value * 100) / 100;
};

const calculateLineTotal = (quantity, unitPrice, discount, tax) => {

    const itemSubtotal = quantity * unitPrice;

    const discountAmount = roundToTwo(itemSubtotal * (discount / 100));

    const taxableAmount = itemSubtotal - discountAmount;

    const taxAmount = roundToTwo(taxableAmount * (tax / 100));

    const lineTotal = roundToTwo(taxableAmount + taxAmount);

    return {

        itemSubtotal: roundToTwo(itemSubtotal),

        discountAmount,

        taxAmount,

        lineTotal

    };

};

const calculateOrderTotals = (items) => {

    let subtotal = 0;

    let totalDiscount = 0;

    let totalTax = 0;

    for (const item of items) {

        const itemSubtotal = item.quantity * item.unitPrice;

        const discountAmount = roundToTwo(itemSubtotal * ((item.discount || 0) / 100));

        const taxableAmount = itemSubtotal - discountAmount;

        const taxAmount = roundToTwo(taxableAmount * ((item.tax || 0) / 100));

        const lineTotal = roundToTwo(taxableAmount + taxAmount);

        item.lineTotal = lineTotal;

        subtotal += itemSubtotal;

        totalDiscount += discountAmount;

        totalTax += taxAmount;

    }

    return {

        subtotal: roundToTwo(subtotal),

        discount: roundToTwo(totalDiscount),

        tax: roundToTwo(totalTax),

        grandTotal: roundToTwo(subtotal - totalDiscount + totalTax)

    };

};

// ----------------------------
// Create Order
// ----------------------------

const createOrder = async (orderData, loggedInUser) => {

    const {
        customerProfileId,
        items,
        quotationId,
        paymentStatus = "pending",
        orderStatus = "pending",
        notes,
        salespersonId
    } = orderData;

    const customerProfile = await CustomerProfile.findById(customerProfileId);

    if (!customerProfile) {

        throw new BusinessError("Customer not found.", 404);

    }

    if (!customerProfile.assignedSalesperson) {

        throw new BusinessError("Customer is not assigned to any salesperson.", 400);

    }

    let salespersonIdToUse = salespersonId;

    if (!salespersonIdToUse) {

        salespersonIdToUse = customerProfile.assignedSalesperson.toString();

    }

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(customerProfileId, loggedInUser);

        salespersonIdToUse = loggedInUser._id.toString();

    } else if (loggedInUser.role === "manager") {

        if (salespersonIdToUse !== customerProfile.assignedSalesperson.toString()) {

            salespersonIdToUse = customerProfile.assignedSalesperson.toString();

        }

    } else if (loggedInUser.role === "customer") {

        if (customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You can only place orders on your own account.", 403);

        }

        salespersonIdToUse = customerProfile.assignedSalesperson.toString();

    }

    let quotation = null;

    if (quotationId) {

        quotation = await Quotation.findById(quotationId);

        if (!quotation) {

            throw new BusinessError("Quotation not found.", 404);

        }

        if (quotation.customerProfile.toString() !== customerProfileId) {

            throw new BusinessError("Quotation does not belong to this customer.", 400);

        }

    }

    const validatedItems = [];

    for (const item of items) {

        const product = await Product.findById(item.product);

        if (!product) {

            throw new BusinessError(`Product not found: ${item.product}`, 404);

        }

        if (product.status !== "active") {

            throw new BusinessError(`Product is not active: ${product.name}`, 400);

        }

        if (product.stock < item.quantity) {

            throw new BusinessError(`Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`, 400);

        }

        validatedItems.push({

            product: product._id,

            productName: product.name,

            quantity: item.quantity,

            unitPrice: product.sellingPrice,

            discount: item.discount != null ? item.discount : 0,

            tax: item.tax != null ? item.tax : (product.tax || 0)

        });

    }

    const totals = calculateOrderTotals(validatedItems);

    const order = await Order.create({

        customerProfile: customerProfileId,

        salesperson: salespersonIdToUse,

        quotation: quotationId || null,

        items: validatedItems,

        ...totals,

        paymentStatus,

        orderStatus,

        notes: notes || "",

        createdBy: loggedInUser._id

    });

    await order.populate([

        { path: "customerProfile", select: "user businessName" },

        { path: "salesperson", select: "Name email" },

        { path: "quotation", select: "status grandTotal" },

        { path: "createdBy", select: "Name email" }

    ]);

    // Deduct inventory and create movements
    for (const item of validatedItems) {

        const product = await Product.findById(item.product);

        const previousStock = product.stock;

        const newStock = previousStock - item.quantity;

        product.stock = newStock;

        product.updatedBy = loggedInUser._id;

        await product.save();

        await InventoryMovement.create({

            product: product._id,

            type: "order",

            quantity: item.quantity,

            previousStock,

            newStock,

            performedBy: loggedInUser._id,

            reason: `Order #${order._id}`,

            reference: order._id.toString()

        });

    }

    // Update customer financial metrics
    customerProfile.totalOrders += 1;

    customerProfile.totalRevenue += totals.grandTotal;

    await customerProfile.save();

    // Create customer activity
    await createInternalActivity({

        customerProfileId,

        createdBy: loggedInUser._id,

        activityType: "order",

        title: "Order Created",

        description: `Order #${order._id} created for ${customerProfile.businessName} with grand total ${totals.grandTotal}.`,

        metadata: {

            orderId: order._id,

            quotationId: quotationId || null,

            grandTotal: totals.grandTotal,

            itemCount: validatedItems.length,

            paymentStatus,

            orderStatus

        }

    });

    // Notify the assigned salesperson when the customer places an order
    if (loggedInUser.role === "customer" && salespersonIdToUse) {
        try {
            await createNotification({
                recipient: salespersonIdToUse,
                type: "order_created",
                title: "New order placed",
                message: `${customerProfile.businessName} placed an order (₹${totals.grandTotal.toLocaleString()}).`,
                referenceEntity: "Order",
                referenceId: order._id
            });
        } catch (e) { /* non-fatal */ }
    }

    return buildOrderDetail(order);

};

// ----------------------------
// Get Orders
// ----------------------------

const getOrders = async (query, loggedInUser) => {

    const {
        page = 1,
        limit = 10,
        orderStatus,
        paymentStatus,
        customerProfileId,
        salespersonId,
        startDate,
        endDate,
        sort = "-createdAt"
    } = query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const skip = (pageNumber - 1) * limitNumber;

    const filter = {};

    if (orderStatus) {
        filter.orderStatus = orderStatus;
    }

    if (paymentStatus) {
        filter.paymentStatus = paymentStatus;
    }

    if (customerProfileId) {
        filter.customerProfile = customerProfileId;
    }

    if (salespersonId) {
        filter.salesperson = salespersonId;
    }

    if (startDate || endDate) {
        filter.createdAt = {};

        if (startDate) {
            filter.createdAt.$gte = new Date(startDate);
        }

        if (endDate) {
            filter.createdAt.$lte = new Date(endDate);
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

                totalOrders: 0,

                totalPages: 0,

                orders: []

            };

        }

        filter.customerProfile = customerProfile._id;

    }

    const totalOrders = await Order.countDocuments(filter);

    const orders = await Order.find(filter)

        .populate({ path: "customerProfile", select: "user businessName" })

        .populate({ path: "salesperson", select: "Name email" })

        .populate({ path: "quotation", select: "status grandTotal" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort(sort)

        .skip(skip)

        .limit(limitNumber);

    return {

        page: pageNumber,

        limit: limitNumber,

        totalOrders,

        totalPages: Math.ceil(totalOrders / limitNumber),

        orders: buildOrderList(orders)

    };

};

// ----------------------------
// Get Order By ID
// ----------------------------

const getOrderById = async (orderId, loggedInUser) => {

    const order = await Order.findById(orderId)

        .populate({ path: "customerProfile", select: "user businessName" })

        .populate({ path: "salesperson", select: "Name email" })

        .populate({ path: "quotation", select: "status grandTotal" })

        .populate({ path: "createdBy", select: "Name email" });

    if (!order) {

        throw new BusinessError("Order not found.", 404);

    }

    if (loggedInUser.role === "salesperson") {

        const customerProfile = await CustomerProfile.findById(order.customerProfile);

        if (!customerProfile || !customerProfile.assignedSalesperson ||

            customerProfile.assignedSalesperson.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access this order.", 403);

        }

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findById(order.customerProfile);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access this order.", 403);

        }

    }

    return buildOrderDetail(order);

};

// ----------------------------
// Update Order Status
// ----------------------------

const updateOrderStatus = async (orderId, newStatus, loggedInUser) => {

    const order = await Order.findById(orderId);

    if (!order) {

        throw new BusinessError("Order not found.", 404);

    }

    if (!order.canTransitionTo(newStatus)) {

        throw new BusinessError(

            `Invalid status transition from ${order.orderStatus} to ${newStatus}.`,

            400

        );

    }

    if (loggedInUser.role === "salesperson") {

        const customerProfile = await CustomerProfile.findById(order.customerProfile);

        if (!customerProfile || !customerProfile.assignedSalesperson ||

            customerProfile.assignedSalesperson.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to update this order status.", 403);

        }

    }

    const oldStatus = order.orderStatus;

    // Restore inventory when cancelling an order that had stock reserved
    const wasStockReserved = ["pending", "confirmed", "processing"].includes(oldStatus);
    if (newStatus === "cancelled" && wasStockReserved) {
        for (const item of order.items) {
            const product = await Product.findById(item.product);
            if (!product) continue;
            const previousStock = product.stock;
            const newStock = previousStock + item.quantity;
            product.stock = newStock;
            product.updatedBy = loggedInUser._id;
            await product.save();
            await InventoryMovement.create({
                product: product._id,
                type: "cancellation",
                quantity: item.quantity,
                previousStock,
                newStock,
                performedBy: loggedInUser._id,
                reason: `Order #${order._id} cancelled`,
                reference: order._id.toString()
            });
        }

        // Reverse the customer financial totals so the cancelled order does not linger in metrics
        const cp = await CustomerProfile.findById(order.customerProfile);
        if (cp) {
            cp.totalOrders = Math.max(0, (cp.totalOrders || 0) - 1);
            cp.totalRevenue = Math.max(0, (cp.totalRevenue || 0) - (order.grandTotal || 0));
            await cp.save();
        }
    }

    order.orderStatus = newStatus;

    await order.save();

    await order.populate([

        { path: "customerProfile", select: "user businessName" },

        { path: "salesperson", select: "Name email" },

        { path: "quotation", select: "status grandTotal" },

        { path: "createdBy", select: "Name email" }

    ]);

    const activityTitleMap = {

        confirmed: "Order Confirmed",

        processing: "Order Processing",

        completed: "Order Completed",

        cancelled: "Order Cancelled"

    };

    if (activityTitleMap[newStatus]) {

        await createInternalActivity({

            customerProfileId: order.customerProfile,

            createdBy: loggedInUser._id,

            activityType: "order",

            title: activityTitleMap[newStatus],

            description: `Order #${order._id} status changed from ${oldStatus} to ${newStatus}.`,

            metadata: {

                orderId: order._id,

                quotationId: order.quotation,

                oldStatus,

                newStatus,

                grandTotal: order.grandTotal

            }

        });

    }

    const notificationTypeMap = {

        completed: "order_completed",

        cancelled: "order_cancelled"

    };

    if (notificationTypeMap[newStatus]) {

        const customerProfile = await CustomerProfile.findById(order.customerProfile);

        if (customerProfile) {

            const recipientId = newStatus === "completed" ?

                order.salesperson?._id || order.salesperson :

                customerProfile.user;

            if (recipientId) {

                await createNotification({

                    recipient: recipientId,

                    type: notificationTypeMap[newStatus],

                    title: activityTitleMap[newStatus],

                    message: `Order #${order._id} has been ${newStatus}.`,

                    referenceEntity: "order",

                    referenceId: order._id

                });

            }

        }

    }

    return buildOrderDetail(order);

};

// ----------------------------
// Update Payment Status
// ----------------------------

const updatePaymentStatus = async (orderId, newPaymentStatus, loggedInUser) => {

    const order = await Order.findById(orderId);

    if (!order) {

        throw new BusinessError("Order not found.", 404);

    }

    if (loggedInUser.role === "salesperson") {

        const customerProfile = await CustomerProfile.findById(order.customerProfile);

        if (!customerProfile || !customerProfile.assignedSalesperson ||

            customerProfile.assignedSalesperson.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to update this payment status.", 403);

        }

    }

    const oldPaymentStatus = order.paymentStatus;

    order.paymentStatus = newPaymentStatus;

    await order.save();

    await order.populate([

        { path: "customerProfile", select: "user businessName" },

        { path: "salesperson", select: "Name email" },

        { path: "quotation", select: "status grandTotal" },

        { path: "createdBy", select: "Name email" }

    ]);

    await createInternalActivity({

        customerProfileId: order.customerProfile,

        createdBy: loggedInUser._id,

        activityType: "order",

        title: "Payment Status Updated",

        description: `Order #${order._id} payment status changed from ${oldPaymentStatus} to ${newPaymentStatus}.`,

        metadata: {

            orderId: order._id,

            oldPaymentStatus,

            newPaymentStatus,

            grandTotal: order.grandTotal

        }

    });

    return buildOrderDetail(order);

};

// ----------------------------
// Get Customer Orders
// ----------------------------

const getCustomerOrders = async (customerProfileId, loggedInUser) => {

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(customerProfileId, loggedInUser);

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findById(customerProfileId);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access these orders.", 403);

        }

    }

    const orders = await Order.find({ customerProfile: customerProfileId })

        .populate({ path: "salesperson", select: "Name email" })

        .populate({ path: "quotation", select: "status grandTotal" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort({ createdAt: -1 });

    return {

        success: true,

        count: orders.length,

        orders: buildOrderList(orders)

    };

};

// ----------------------------
// Get Salesperson Orders
// ----------------------------

const getSalespersonOrders = async (salespersonId, loggedInUser) => {

    if (loggedInUser.role === "salesperson" && loggedInUser._id.toString() !== salespersonId) {

        throw new BusinessError("You are not authorized to access these orders.", 403);

    }

    const orders = await Order.find({ salesperson: salespersonId })

        .populate({ path: "customerProfile", select: "user businessName" })

        .populate({ path: "quotation", select: "status grandTotal" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort({ createdAt: -1 });

    return {

        success: true,

        count: orders.length,

        orders: buildOrderList(orders)

    };

};

module.exports = {

    createOrder,

    getOrders,

    getOrderById,

    updateOrderStatus,

    updatePaymentStatus,

    getCustomerOrders,

    getSalespersonOrders

};
