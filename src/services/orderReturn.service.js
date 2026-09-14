const OrderReturn = require("../models/orderReturn.model");
const Order = require("../models/order.model");
const Product = require("../models/product.model");
const CustomerProfile = require("../models/customerProfile.model");
const InventoryMovement = require("../models/inventoryMovement.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildOrderReturnDetail,
    buildOrderReturnSummary,
    buildOrderReturnList
} = require("../dto/orderReturn.dto");

const { verifyCustomerOwnership } = require("../helpers/customerOwnership.helper");
const {
    createInternalActivity
} = require("./customerActivity.service");

const {
    createNotification,
    notifyAllAdmins
} = require("./notification.service");

// ----------------------------
// Calculation Helpers
// ----------------------------

const roundToTwo = (value) => {
    return Math.round(value * 100) / 100;
};

// ----------------------------
// Create Order Return
// ----------------------------

const createOrderReturn = async (returnData, loggedInUser) => {

    const {
        orderId,
        items,
        returnType,
        reason
    } = returnData;

    const order = await Order.findById(orderId)

        .populate({ path: "customerProfile", select: "user businessName" });

    if (!order) {

        throw new BusinessError("Order not found.", 404);

    }

    if (order.orderStatus === "cancelled") {

        throw new BusinessError("Cannot create return for a cancelled order.", 400);

    }

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(order.customerProfile, loggedInUser);

    }

    // Build order item map for quantity validation
    const orderItemMap = {};

    for (const item of order.items) {

        orderItemMap[item.product.toString()] = item.quantity;

    }

    // Calculate total return quantity per product
    const returnQuantityMap = {};

    for (const item of items) {

        if (!orderItemMap[item.product]) {

            throw new BusinessError(`Product ${item.product} is not part of this order.`, 400);

        }

        const previousReturnQuantity = returnQuantityMap[item.product] || 0;

        const requestedQuantity = previousReturnQuantity + item.quantity;

        if (requestedQuantity > orderItemMap[item.product]) {

            throw new BusinessError(

                `Return quantity for product ${item.product} exceeds ordered quantity. Ordered: ${orderItemMap[item.product]}, Requested: ${requestedQuantity}`,

                400

            );

        }

        returnQuantityMap[item.product] = requestedQuantity;

    }

    // Check if full return
    const isFullReturn = Object.keys(returnQuantityMap).length === order.items.length &&

        Object.values(returnQuantityMap).every((qty, idx) => {

            const productId = Object.keys(returnQuantityMap)[idx];

            return qty === orderItemMap[productId];

        });

    const validatedItems = [];

    for (const item of items) {

        const product = await Product.findById(item.product);

        if (!product) {

            throw new BusinessError(`Product not found: ${item.product}`, 404);

        }

        validatedItems.push({

            product: product._id,

            productName: product.name,

            quantity: item.quantity,

            unitPrice: product.sellingPrice,

            lineTotal: roundToTwo(item.quantity * product.sellingPrice)

        });

    }

    const orderReturn = await OrderReturn.create({

        order: orderId,

        customerProfile: order.customerProfile,

        items: validatedItems,

        returnType: isFullReturn ? "full" : "partial",

        reason,

        status: "pending",

        createdBy: loggedInUser._id

    });

    await orderReturn.populate([

        { path: "customerProfile", select: "user businessName" },

        { path: "createdBy", select: "Name email" }

    ]);

    // Create customer activity
    await createInternalActivity({

        customerProfileId: order.customerProfile,

        createdBy: loggedInUser._id,

        activityType: "order",

        title: "Order Return Requested",

        description: `Return requested for Order #${orderId}. Type: ${isFullReturn ? "Full" : "Partial"}. Reason: ${reason}`,

        metadata: {

            orderId,

            returnId: orderReturn._id,

            returnType: isFullReturn ? "full" : "partial",

            reason,

            itemCount: validatedItems.length

        }

    });

    // Alert every admin so a filed return shows up on the admin dashboard immediately.
    await notifyAllAdmins({
        type: "return_created",
        title: "New return request",
        message: `${orderReturn.customerProfile?.businessName || "Customer"} filed a ${isFullReturn ? "full" : "partial"} return on order #${String(orderId).slice(-6)}.`,
        referenceEntity: "OrderReturn",
        referenceId: orderReturn._id
    });

    return buildOrderReturnDetail(orderReturn);

};

// ----------------------------
// Update Order Return Status
// ----------------------------

const updateOrderReturnStatus = async (returnId, newStatus, loggedInUser) => {

    const orderReturn = await OrderReturn.findById(returnId)

        .populate({ path: "order", select: "orderStatus customerProfile grandTotal" })

        .populate({ path: "customerProfile", select: "user businessName" });

    if (!orderReturn) {

        throw new BusinessError("Order return not found.", 404);

    }

    if (!orderReturn.canTransitionTo(newStatus)) {

        throw new BusinessError(

            `Invalid status transition from ${orderReturn.status} to ${newStatus}.`,

            400

        );

    }

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(orderReturn.customerProfile, loggedInUser);

    }

    const oldStatus = orderReturn.status;

    orderReturn.status = newStatus;

    await orderReturn.save();

    await orderReturn.populate([

        { path: "customerProfile", select: "user businessName" },

        { path: "createdBy", select: "Name email" }

    ]);

    // If return is completed, restore inventory
    if (newStatus === "completed") {

        const order = await Order.findById(orderReturn.order);

        if (order) {

            for (const item of orderReturn.items) {

                const product = await Product.findById(item.product);

                if (product) {

                    const previousStock = product.stock;

                    const newStock = previousStock + item.quantity;

                    product.stock = newStock;

                    product.updatedBy = loggedInUser._id;

                    await product.save();

                    await InventoryMovement.create({

                        product: product._id,

                        type: "returned",

                        quantity: item.quantity,

                        previousStock,

                        newStock,

                        performedBy: loggedInUser._id,

                        reason: `Return for Order #${orderReturn.order}`,

                        reference: orderReturn._id.toString()

                    });

                }

            }

            // Update order status if full return
            if (orderReturn.returnType === "full") {

                order.orderStatus = "cancelled";

                order.paymentStatus = "cancelled";

                await order.save();

            }

            // Update customer metrics
            const customerProfile = await CustomerProfile.findById(orderReturn.customerProfile);

            if (customerProfile) {

                const totalReturnAmount = orderReturn.items.reduce(

                    (sum, item) => sum + item.lineTotal,

                    0

                );

                customerProfile.totalRevenue = roundToTwo(Math.max(0, customerProfile.totalRevenue - totalReturnAmount));

                if (orderReturn.returnType === "full") {

                    customerProfile.totalOrders = Math.max(0, customerProfile.totalOrders - 1);

                }

                await customerProfile.save();

            }

        }

    }

    // Create customer activity
    const activityTitleMap = {

        approved: "Order Return Approved",

        rejected: "Order Return Rejected",

        completed: "Order Return Completed"

    };

    if (activityTitleMap[newStatus]) {

        await createInternalActivity({

            customerProfileId: orderReturn.customerProfile,

            createdBy: loggedInUser._id,

            activityType: "order",

            title: activityTitleMap[newStatus],

            description: `Order return #${orderReturn._id} status changed from ${oldStatus} to ${newStatus}.`,

            metadata: {

                returnId: orderReturn._id,

                orderId: orderReturn.order,

                oldStatus,

                newStatus,

                returnType: orderReturn.returnType

            }

        });

    }

    const notificationTypeMap = {

        approved: "return_approved",

        rejected: "return_rejected",

        completed: "return_completed"

    };

    if (notificationTypeMap[newStatus]) {

        const customerProfile = await CustomerProfile.findById(orderReturn.customerProfile);

        if (customerProfile) {

            await createNotification({

                recipient: customerProfile.user,

                type: notificationTypeMap[newStatus],

                title: activityTitleMap[newStatus],

                message: `Order return #${orderReturn._id} has been ${newStatus}.`,

                referenceEntity: "return",

                referenceId: orderReturn._id

            });

        }

    }

    return buildOrderReturnDetail(orderReturn);

};

// ----------------------------
// Get Order Returns
// ----------------------------

const getOrderReturns = async (orderId, loggedInUser) => {

    const order = await Order.findById(orderId);

    if (!order) {

        throw new BusinessError("Order not found.", 404);

    }

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(order.customerProfile, loggedInUser);

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findById(order.customerProfile);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access these returns.", 403);

        }

    }

    const orderReturns = await OrderReturn.find({ order: orderId })

        .populate({ path: "createdBy", select: "Name email" })

        .sort({ createdAt: -1 });

    return {

        success: true,

        count: orderReturns.length,

        returns: buildOrderReturnList(orderReturns),

        orderReturns: buildOrderReturnList(orderReturns)

    };

};

// ----------------------------
// Get Customer Returns
// ----------------------------

const getCustomerReturns = async (customerProfileId, loggedInUser) => {

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(customerProfileId, loggedInUser);

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findById(customerProfileId);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access these returns.", 403);

        }

    }

    const orderReturns = await OrderReturn.find({ customerProfile: customerProfileId })

        .populate({ path: "order", select: "orderStatus grandTotal" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort({ createdAt: -1 });

    return {

        success: true,

        count: orderReturns.length,

        returns: buildOrderReturnList(orderReturns),

        orderReturns: buildOrderReturnList(orderReturns)

    };

};

// ----------------------------
// Get All Returns (Admin, Manager)
// ----------------------------

const getAllReturns = async (query, loggedInUser) => {

    const {

        page = 1,

        limit = 10,

        orderId,

        customerProfileId,

        status,

        sort = "-createdAt"

    } = query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const filter = {};

    if (orderId) {
        filter.order = orderId;
    }

    if (customerProfileId) {
        filter.customerProfile = customerProfileId;
    }

    if (status) {
        filter.status = status;
    }

    const totalReturns = await OrderReturn.countDocuments(filter);

    const orderReturns = await OrderReturn.find(filter)

        .populate({ path: "order", select: "orderStatus grandTotal" })

        .populate({ path: "customerProfile", select: "user businessName" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort(sort)

        .skip(skip)

        .limit(limitNumber);

    return {

        success: true,

        page: pageNumber,

        limit: limitNumber,

        totalReturns,

        totalPages: Math.ceil(totalReturns / limitNumber),

        returns: buildOrderReturnList(orderReturns)

    };

};

const getOrderReturnById = async (returnId, loggedInUser) => {
    const orderReturn = await OrderReturn.findById(returnId)
        .populate({
            path: "customerProfile",
            select: "user businessName assignedSalesperson",
            populate: [
                { path: "user", select: "Name phoneNumber" },
                { path: "assignedSalesperson", select: "Name email phoneNumber" }
            ]
        })
        .populate({
            path: "order",
            select: "orderStatus grandTotal createdAt salesperson",
            populate: { path: "salesperson", select: "Name email" }
        })
        .populate({ path: "createdBy", select: "Name email role" });

    if (!orderReturn) {
        throw new BusinessError("Return not found.", 404);
    }

    if (loggedInUser.role === "customer") {
        const cp = orderReturn.customerProfile;
        if (!cp || cp.user?._id?.toString() !== loggedInUser._id.toString()) {
            throw new BusinessError("You are not authorized to view this return.", 403);
        }
    }
    if (loggedInUser.role === "salesperson") {
        const cp = orderReturn.customerProfile;
        if (!cp || cp.assignedSalesperson?._id?.toString() !== loggedInUser._id.toString()) {
            throw new BusinessError("You are not authorized to view this return.", 403);
        }
    }

    return {
        success: true,
        return: {
            id: orderReturn._id,
            orderId: orderReturn.order?._id || orderReturn.order,
            order: orderReturn.order,
            customerProfileId: orderReturn.customerProfile?._id || orderReturn.customerProfile,
            customerProfile: orderReturn.customerProfile,
            items: orderReturn.items.map((it) => ({
                id: it._id,
                product: it.product,
                productName: it.productName,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                lineTotal: it.lineTotal
            })),
            returnType: orderReturn.returnType,
            reason: orderReturn.reason,
            status: orderReturn.status,
            createdBy: orderReturn.createdBy,
            createdAt: orderReturn.createdAt,
            updatedAt: orderReturn.updatedAt
        }
    };
};

module.exports = {

    createOrderReturn,

    updateOrderReturnStatus,

    getOrderReturns,

    getCustomerReturns,

    getAllReturns,

    getOrderReturnById

};
