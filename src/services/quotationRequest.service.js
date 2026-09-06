const QuotationRequest = require("../models/quotationRequest.model");
const CustomerProfile = require("../models/customerProfile.model");
const Product = require("../models/product.model");
const User = require("../models/user.model");
const BusinessError = require("../utils/errors/businessError");
const { createNotification } = require("./notification.service");
const { createInternalActivity } = require("./customerActivity.service");

/** Customer creates a quotation request for their own account. */
const createRequest = async ({ customerProfileId, items, notes }, loggedInUser) => {
    const profile = await CustomerProfile.findById(customerProfileId);
    if (!profile) throw new BusinessError("Customer profile not found.", 404);

    // Ownership: customer can only file requests on their own account
    if (loggedInUser.role === "customer" &&
        profile.user.toString() !== loggedInUser._id.toString()) {
        throw new BusinessError("You can only file requests on your own account.", 403);
    }
    if (!profile.assignedSalesperson) {
        throw new BusinessError("You are not assigned to a salesperson yet. Contact admin.", 400);
    }
    if (!Array.isArray(items) || items.length === 0) {
        throw new BusinessError("At least one item is required.", 400);
    }

    // Enrich items with productName
    const productIds = items.map((i) => i.product);
    const products = await Product.find({ _id: { $in: productIds } }).select("name status");
    const productMap = new Map(products.map((p) => [p._id.toString(), p]));
    const enriched = items.map((it) => {
        const p = productMap.get(String(it.product));
        if (!p) throw new BusinessError(`Product not found: ${it.product}`, 404);
        return {
            product: p._id,
            productName: p.name,
            quantity: it.quantity,
            notes: it.notes,
        };
    });

    const request = await QuotationRequest.create({
        customerProfile: profile._id,
        salesperson: profile.assignedSalesperson,
        items: enriched,
        notes: notes || "",
        status: "pending_salesperson",
        createdBy: loggedInUser._id,
    });

    // Notify salesperson
    try {
        await createNotification({
            recipient: profile.assignedSalesperson,
            type: "quotation_requested",
            title: "New quotation request",
            message: `${profile.businessName} asked for a quotation on ${enriched.length} item(s).`,
            referenceEntity: "QuotationRequest",
            referenceId: request._id,
        });
    } catch (_) {}

    try {
        await createInternalActivity({
            customerProfileId: profile._id,
            createdBy: loggedInUser._id,
            activityType: "quotation",
            title: "Quotation requested by customer",
            description: `${enriched.length} item(s). Notes: ${notes || "—"}`,
            metadata: { quotationRequestId: request._id }
        });
    } catch (_) {}

    return { success: true, request };
};

/** Salesperson forwards a request to a manager (or all managers if none picked). */
const forwardToManager = async (requestId, loggedInUser, managerId) => {
    const req = await QuotationRequest.findById(requestId);
    if (!req) throw new BusinessError("Request not found.", 404);

    if (loggedInUser.role === "salesperson" &&
        req.salesperson.toString() !== loggedInUser._id.toString()) {
        throw new BusinessError("This request is not assigned to you.", 403);
    }
    if (req.status !== "pending_salesperson") {
        throw new BusinessError(`Cannot forward — current status is ${req.status}.`, 400);
    }

    let target = managerId;
    if (!target) {
        // pick the first active manager
        const mgr = await User.findOne({ role: "manager", status: { $ne: "suspended" } }).select("_id");
        if (!mgr) throw new BusinessError("No active manager to forward to.", 400);
        target = mgr._id;
    }

    req.manager = target;
    req.status = "pending_manager";
    await req.save();

    try {
        await createNotification({
            recipient: target,
            type: "quotation_requested",
            title: "Quotation request forwarded",
            message: `Salesperson forwarded a request. Please prepare a quotation.`,
            referenceEntity: "QuotationRequest",
            referenceId: req._id,
        });
    } catch (_) {}

    return { success: true, request: req };
};

/** Called by quotation.service when a Quotation is created against a request. */
const markQuoted = async (requestId, quotationId) => {
    await QuotationRequest.findByIdAndUpdate(requestId, {
        status: "quoted",
        quotation: quotationId,
    });
};

const rejectRequest = async (requestId, loggedInUser, reason) => {
    const req = await QuotationRequest.findById(requestId);
    if (!req) throw new BusinessError("Request not found.", 404);
    if (req.status === "quoted") throw new BusinessError("Already quoted.", 400);
    req.status = "rejected";
    if (reason) req.notes = `${req.notes || ""}\n[Rejected] ${reason}`.trim();
    await req.save();
    return { success: true, request: req };
};

/** List requests scoped by role. */
const listRequests = async (loggedInUser, filters = {}) => {
    const q = {};
    if (filters.status) q.status = filters.status;

    if (loggedInUser.role === "customer") {
        const profile = await CustomerProfile.findOne({ user: loggedInUser._id });
        if (!profile) return { success: true, requests: [] };
        q.customerProfile = profile._id;
    } else if (loggedInUser.role === "salesperson") {
        q.salesperson = loggedInUser._id;
    } else if (loggedInUser.role === "manager") {
        // managers see requests forwarded to them OR unassigned pending_manager
        q.$or = [{ manager: loggedInUser._id }, { manager: null, status: "pending_manager" }];
    } // admin: no filter

    const list = await QuotationRequest.find(q)
        .populate({ path: "customerProfile", select: "businessName user", populate: { path: "user", select: "Name phoneNumber" } })
        .populate({ path: "salesperson", select: "Name email" })
        .populate({ path: "manager", select: "Name email" })
        .sort("-createdAt")
        .limit(100);

    return { success: true, requests: list };
};

const getRequestById = async (id, loggedInUser) => {
    const r = await QuotationRequest.findById(id)
        .populate({ path: "customerProfile", select: "businessName user assignedSalesperson", populate: { path: "user", select: "Name phoneNumber" } })
        .populate({ path: "salesperson", select: "Name email phoneNumber" })
        .populate({ path: "manager", select: "Name email" })
        .populate({ path: "createdBy", select: "Name role" });
    if (!r) throw new BusinessError("Request not found.", 404);

    // Access control
    if (loggedInUser.role === "customer") {
        if (r.customerProfile?.user?._id.toString() !== loggedInUser._id.toString()) {
            throw new BusinessError("Not authorized.", 403);
        }
    } else if (loggedInUser.role === "salesperson") {
        if (r.salesperson?._id.toString() !== loggedInUser._id.toString()) {
            throw new BusinessError("Not authorized.", 403);
        }
    }
    return { success: true, request: r };
};

module.exports = { createRequest, forwardToManager, markQuoted, rejectRequest, listRequests, getRequestById };
