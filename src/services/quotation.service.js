const Quotation = require("../models/quotation.model");
const Product = require("../models/product.model");
const CustomerProfile = require("../models/customerProfile.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildQuotationDetail,
    buildQuotationSummary,
    buildQuotationList
} = require("../dto/quotation.dto");

const {
    verifyCustomerOwnership
} = require("../helpers/customerOwnership.helper");

const {
    createInternalActivity
} = require("./customerActivity.service");

const {
    createNotification
} = require("./notification.service");

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

const calculateQuotationTotals = (items) => {

    let subtotal = 0;

    let totalDiscount = 0;

    let totalTax = 0;

    for (const item of items) {

        const { itemSubtotal, discountAmount, taxAmount, lineTotal } = calculateLineTotal(

            item.quantity,

            item.unitPrice,

            item.discount || 0,

            item.tax || 0

        );

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
// Create Quotation
// ----------------------------

const createQuotation = async (quotationData, loggedInUser) => {

    const {
        customerProfileId,
        items,
        validUntil,
        notes,
        salespersonId,
        quotationRequestId
    } = quotationData;

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

        validatedItems.push({

            product: product._id,

            productName: product.name,

            quantity: item.quantity,

            unitPrice: product.sellingPrice,

            discount: item.discount || 0,

            tax: item.tax || 0

        });

    }

    const totals = calculateQuotationTotals(validatedItems);

    const quotation = await Quotation.create({

        customerProfile: customerProfileId,

        salesperson: salespersonIdToUse,

        items: validatedItems,

        ...totals,

        status: "draft",

        validUntil: validUntil || null,

        notes: notes || "",

        createdBy: loggedInUser._id

    });

    await quotation.populate([

        { path: "customerProfile", select: "user businessName" },

        { path: "salesperson", select: "Name email" },

        { path: "createdBy", select: "Name email" }

    ]);

    await createInternalActivity({

        customerProfileId,

        createdBy: loggedInUser._id,

        activityType: "quotation",

        title: "Quotation Created",

        description: `Quotation #${quotation._id} created for ${customerProfile.businessName}.`,

        metadata: {

            quotationId: quotation._id,

            grandTotal: totals.grandTotal,

            itemCount: validatedItems.length

        }

    });

    await createNotification({

        recipient: customerProfile.user,

        type: "quotation_created",

        title: "New Quotation Created",

        message: `A new quotation #${quotation._id} has been created for ${customerProfile.businessName}.`,

        referenceEntity: "quotation",

        referenceId: quotation._id

    });

    // If this quotation was created against a customer request, mark it quoted.
    if (quotationRequestId) {
        try {
            const { markQuoted } = require("./quotationRequest.service");
            await markQuoted(quotationRequestId, quotation._id);
        } catch (_) { /* non-fatal */ }
    }

    return buildQuotationDetail(quotation);

};

// ----------------------------
// Get Quotations
// ----------------------------

const getQuotations = async (query, loggedInUser) => {

    const {
        page = 1,
        limit = 10,
        status,
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

    if (status) {
        filter.status = status;
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

                totalQuotations: 0,

                totalPages: 0,

                quotations: []

            };

        }

        filter.customerProfile = customerProfile._id;

    }

    const totalQuotations = await Quotation.countDocuments(filter);

    const quotations = await Quotation.find(filter)

        .populate({ path: "customerProfile", select: "user businessName" })

        .populate({ path: "salesperson", select: "Name email" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort(sort)

        .skip(skip)

        .limit(limitNumber);

    return {

        page: pageNumber,

        limit: limitNumber,

        totalQuotations,

        totalPages: Math.ceil(totalQuotations / limitNumber),

        quotations: buildQuotationList(quotations)

    };

};

// ----------------------------
// Get Quotation By ID
// ----------------------------

const getQuotationById = async (quotationId, loggedInUser) => {

    const quotation = await Quotation.findById(quotationId)

        .populate({ path: "customerProfile", select: "user businessName" })

        .populate({ path: "salesperson", select: "Name email" })

        .populate({ path: "createdBy", select: "Name email" });

    if (!quotation) {

        throw new BusinessError("Quotation not found.", 404);

    }

    if (loggedInUser.role === "salesperson") {

        const customerProfile = await CustomerProfile.findById(quotation.customerProfile);

        if (!customerProfile || !customerProfile.assignedSalesperson ||

            customerProfile.assignedSalesperson.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access this quotation.", 403);

        }

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findById(quotation.customerProfile);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access this quotation.", 403);

        }

    }

    return buildQuotationDetail(quotation);

};

// ----------------------------
// Update Quotation
// ----------------------------

const updateQuotation = async (quotationId, updateData, loggedInUser) => {

    const quotation = await Quotation.findById(quotationId);

    if (!quotation) {

        throw new BusinessError("Quotation not found.", 404);

    }

    if (!quotation.isEditable()) {

        throw new BusinessError("Only draft quotations can be edited.", 400);

    }

    if (loggedInUser.role === "salesperson") {

        const customerProfile = await CustomerProfile.findById(quotation.customerProfile);

        if (!customerProfile || !customerProfile.assignedSalesperson ||

            customerProfile.assignedSalesperson.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to edit this quotation.", 403);

        }

    }

    if (updateData.items) {

        const validatedItems = [];

        for (const item of updateData.items) {

            const product = await Product.findById(item.product);

            if (!product) {

                throw new BusinessError(`Product not found: ${item.product}`, 404);

            }

            if (product.status !== "active") {

                throw new BusinessError(`Product is not active: ${product.name}`, 400);

            }

            validatedItems.push({

                product: product._id,

                productName: product.name,

                quantity: item.quantity,

                unitPrice: product.sellingPrice,

                discount: item.discount || 0,

                tax: item.tax || 0

            });

        }

        const totals = calculateQuotationTotals(validatedItems);

        quotation.items = validatedItems;

        quotation.subtotal = totals.subtotal;

        quotation.discount = totals.discount;

        quotation.tax = totals.tax;

        quotation.grandTotal = totals.grandTotal;

    }

    if (updateData.validUntil !== undefined) {

        quotation.validUntil = updateData.validUntil;

    }

    if (updateData.notes !== undefined) {

        quotation.notes = updateData.notes;

    }

    await quotation.save();

    await quotation.populate([

        { path: "customerProfile", select: "user businessName" },

        { path: "salesperson", select: "Name email" },

        { path: "createdBy", select: "Name email" }

    ]);

    return buildQuotationDetail(quotation);

};

// ----------------------------
// Update Quotation Status
// ----------------------------

const updateQuotationStatus = async (quotationId, newStatus, loggedInUser) => {

    const quotation = await Quotation.findById(quotationId);

    if (!quotation) {

        throw new BusinessError("Quotation not found.", 404);

    }

    if (!quotation.canTransitionTo(newStatus)) {

        throw new BusinessError(

            `Invalid status transition from ${quotation.status} to ${newStatus}.`,

            400

        );

    }

    if (loggedInUser.role === "salesperson") {

        const customerProfile = await CustomerProfile.findById(quotation.customerProfile);

        if (!customerProfile || !customerProfile.assignedSalesperson ||

            customerProfile.assignedSalesperson.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to update this quotation status.", 403);

        }

    }

    if (loggedInUser.role === "customer") {

        if (!["accepted", "rejected"].includes(newStatus)) {

            throw new BusinessError("Customers can only accept or reject a quotation.", 403);

        }

        const customerProfile = await CustomerProfile.findById(quotation.customerProfile);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to update this quotation.", 403);

        }

    }

    const oldStatus = quotation.status;

    quotation.status = newStatus;

    await quotation.save();

    await quotation.populate([

        { path: "customerProfile", select: "user businessName" },

        { path: "salesperson", select: "Name email" },

        { path: "createdBy", select: "Name email" }

    ]);

    const activityTitleMap = {

        sent: "Quotation Sent",

        accepted: "Quotation Accepted",

        rejected: "Quotation Rejected",

        expired: "Quotation Expired",

        cancelled: "Quotation Cancelled",

        converted: "Quotation Converted to Order"

    };

    if (activityTitleMap[newStatus]) {

        await createInternalActivity({

            customerProfileId: quotation.customerProfile,

            createdBy: loggedInUser._id,

            activityType: "quotation",

            title: activityTitleMap[newStatus],

            description: `Quotation #${quotation._id} status changed from ${oldStatus} to ${newStatus}.`,

            metadata: {

                quotationId: quotation._id,

                oldStatus,

                newStatus,

                grandTotal: quotation.grandTotal

            }

        });

    }

    const notificationTypeMap = {

        sent: "quotation_sent",

        accepted: "quotation_accepted",

        rejected: "quotation_rejected"

    };

    if (notificationTypeMap[newStatus]) {

        const recipientId = newStatus === "accepted" || newStatus === "rejected" ?

            quotation.salesperson?.user?._id || quotation.salesperson?._id :

            quotation.customerProfile?.user;

        if (recipientId) {

            await createNotification({

                recipient: recipientId,

                type: notificationTypeMap[newStatus],

                title: activityTitleMap[newStatus],

                message: `Quotation #${quotation._id} has been ${newStatus}.`,

                referenceEntity: "quotation",

                referenceId: quotation._id

            });

        }

    }

    return buildQuotationDetail(quotation);

};

// ----------------------------
// Get Customer Quotations
// ----------------------------

const getCustomerQuotations = async (customerProfileId, loggedInUser) => {

    if (loggedInUser.role === "salesperson") {

        await verifyCustomerOwnership(customerProfileId, loggedInUser);

    } else if (loggedInUser.role === "customer") {

        const customerProfile = await CustomerProfile.findById(customerProfileId);

        if (!customerProfile || customerProfile.user.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to access these quotations.", 403);

        }

    }

    const quotations = await Quotation.find({ customerProfile: customerProfileId })

        .populate({ path: "salesperson", select: "Name email" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort({ createdAt: -1 });

    return {

        success: true,

        count: quotations.length,

        quotations: buildQuotationList(quotations)

    };

};

// ----------------------------
// Get Salesperson Quotations
// ----------------------------

const getSalespersonQuotations = async (salespersonId, loggedInUser) => {

    if (loggedInUser.role === "salesperson" && loggedInUser._id.toString() !== salespersonId) {

        throw new BusinessError("You are not authorized to access these quotations.", 403);

    }

    const quotations = await Quotation.find({ salesperson: salespersonId })

        .populate({ path: "customerProfile", select: "user businessName" })

        .populate({ path: "createdBy", select: "Name email" })

        .sort({ createdAt: -1 });

    return {

        success: true,

        count: quotations.length,

        quotations: buildQuotationList(quotations)

    };

};

// ----------------------------
// Delete Quotation
// ----------------------------

const deleteQuotation = async (quotationId, loggedInUser) => {

    const quotation = await Quotation.findById(quotationId);

    if (!quotation) {

        throw new BusinessError("Quotation not found.", 404);

    }

    if (!quotation.isDeletable()) {

        throw new BusinessError("This quotation cannot be deleted.", 400);

    }

    if (loggedInUser.role === "salesperson") {

        const customerProfile = await CustomerProfile.findById(quotation.customerProfile);

        if (!customerProfile || !customerProfile.assignedSalesperson ||

            customerProfile.assignedSalesperson.toString() !== loggedInUser._id.toString()) {

            throw new BusinessError("You are not authorized to delete this quotation.", 403);

        }

    }

    await quotation.deleteOne();

    return {

        success: true,

        message: "Quotation deleted successfully."

    };

};

const convertQuotationToOrder = async (quotationId, loggedInUser, options = {}) => {

    const orderService = require("./order.service");

    const quotation = await Quotation.findById(quotationId);

    if (!quotation) {
        throw new BusinessError("Quotation not found.", 404);
    }

    if (quotation.status === "converted") {
        throw new BusinessError("Quotation has already been converted to an order.", 400);
    }

    if (quotation.status !== "accepted") {
        throw new BusinessError(
            `Only accepted quotations can be converted. Current status: ${quotation.status}.`,
            400
        );
    }

    if (loggedInUser.role === "salesperson") {
        const customerProfile = await CustomerProfile.findById(quotation.customerProfile);
        if (!customerProfile ||
            !customerProfile.assignedSalesperson ||
            customerProfile.assignedSalesperson.toString() !== loggedInUser._id.toString()) {
            throw new BusinessError("You are not authorized to convert this quotation.", 403);
        }
    }

    const orderResult = await orderService.createOrder(
        {
            customerProfileId: quotation.customerProfile.toString(),
            items: quotation.items.map((it) => ({
                product: it.product.toString(),
                quantity: it.quantity,
                discount: it.discount,
                tax: it.tax
            })),
            quotationId: quotation._id.toString(),
            notes: options.notes || quotation.notes || undefined
        },
        loggedInUser
    );

    quotation.status = "converted";
    await quotation.save();

    return {
        order: orderResult.order || orderResult,
        quotationId: quotation._id
    };
};

module.exports = {

    createQuotation,

    getQuotations,

    getQuotationById,

    updateQuotation,

    updateQuotationStatus,

    getCustomerQuotations,

    getSalespersonQuotations,

    deleteQuotation,

    convertQuotationToOrder

};
