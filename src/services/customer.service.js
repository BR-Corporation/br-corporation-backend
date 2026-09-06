const CustomerProfile = require("../models/customerProfile.model");
const User = require("../models/user.model");
const BusinessError = require("../utils/errors/businessError");

const {
    buildCustomerSummary,
    buildSalespersonCustomerProfile,
    buildAdminCustomerProfile
} = require("../dto/customer.dto");
const getCustomers = async (query, loggedInUser) => {

    const {
        page = 1,
        limit = 10,
        stage,
        city,
        status,
        sort = "-createdAt"
    } = query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const skip = (pageNumber - 1) * limitNumber;

    const filter = {};

    if (stage) {
        filter.customerStage = stage;
    }

    if (city) {
        filter.city = city;
    }

    if (loggedInUser.role === "manager") {

        const salespersons = await User.find({

            managerId: loggedInUser._id

        }).select("_id");

        const salespersonIds = salespersons.map(sp => sp._id);

        const customerProfiles = await CustomerProfile.find({

            assignedSalesperson: { $in: salespersonIds }

        }).select("_id");

        filter._id = { $in: customerProfiles.map(cp => cp._id) };

    }

    let totalCustomers;
    let customers;

    if (status) {
        const pendingUsers = await User.find({ role: "customer", status }).select("_id");
        const pendingUserIds = pendingUsers.map((u) => u._id);
        filter.user = { $in: pendingUserIds };
        totalCustomers = await CustomerProfile.countDocuments(filter);
        customers = await CustomerProfile.find(filter)
            .populate({
                path: "user",
                select: "Name phoneNumber status role otpBypass"
            })
            .populate({
                path: "assignedSalesperson",
                select: "Name email phoneNumber"
            })
            .sort(sort)
            .skip(skip)
            .limit(limitNumber);
    } else {
        totalCustomers = await CustomerProfile.countDocuments(filter);
        customers = await CustomerProfile.find(filter)
            .populate({
                path: "user",
                select: "Name phoneNumber status role otpBypass"
            })
            .populate({
                path: "assignedSalesperson",
                select: "Name email phoneNumber"
            })
            .sort(sort)
            .skip(skip)
            .limit(limitNumber);
    }

    return {

    page: pageNumber,

    limit: limitNumber,

    totalCustomers,

    totalPages: Math.ceil(totalCustomers / limitNumber),

    customers: customers.map(buildCustomerSummary)

    };
};

const getCustomerById = async (customerProfileId, loggedInUser) => {
    const customer = await CustomerProfile.findById(customerProfileId)
        .populate({
            path: "user",
            select: "Name phoneNumber status role otpBypass"
        })
        .populate({
            path: "assignedSalesperson",
            select: "Name email phoneNumber"
        });

    if (!customer) {
        throw new BusinessError("Customer not found.", 404);
    }
    if (
    loggedInUser.role === "salesperson" &&
    (
        !customer.assignedSalesperson ||
        customer.assignedSalesperson._id.toString() !== loggedInUser._id.toString()
    )
) {
    throw new BusinessError(
        "You are not authorized to access this customer.",
        403
    );
}

    if (loggedInUser.role === "admin" || loggedInUser.role === "manager") {

    return buildAdminCustomerProfile(customer);

    }

    if (loggedInUser.role === "customer") {
        if (!customer.user || customer.user._id.toString() !== loggedInUser._id.toString()) {
            throw new BusinessError(
                "You are not authorized to access this customer.",
                403
            );
        }
    }

    return buildSalespersonCustomerProfile(customer);

};
const getMyCustomers = async (salespersonId) => {

    const customers = await CustomerProfile.find({
        assignedSalesperson: salespersonId
    })
        .populate({
            path: "user",
            select: "Name phoneNumber status role otpBypass"
        });

    return customers.map(buildCustomerSummary);

};

const removeCustomer = async (customerProfileId) => {
    const customerProfile = await CustomerProfile.findById(customerProfileId);
    if (!customerProfile) {
        throw new BusinessError("Customer not found.", 404);
    }

    const user = await User.findById(customerProfile.user);
    if (!user) {
        throw new BusinessError("Customer user not found.", 404);
    }

    if (user.role !== "customer") {
        throw new BusinessError("Selected user is not a customer.", 400);
    }

    if (user.status === "suspended") {
        throw new BusinessError("Customer is already suspended.", 400);
    }

    user.status = "suspended";
    await user.save();

    return {
        success: true,
        message: "Customer has been suspended successfully."
    };
};

/**
 * Customer edits own profile. Only safe fields — cannot change phone, status, assignedSalesperson.
 */
const updateMyProfile = async (userId, patch) => {
    const profile = await CustomerProfile.findOne({ user: userId });
    if (!profile) throw new BusinessError("Customer profile not found.", 404);

    const allowed = [
        "businessName", "businessType", "address", "city", "state", "pincode", "alternatePhoneNumber"
    ];
    const changes = {};
    for (const k of allowed) {
        if (patch[k] !== undefined && patch[k] !== null) changes[k] = patch[k];
    }
    Object.assign(profile, changes);
    await profile.save();

    // If Name was provided, update the linked user
    if (patch.Name) {
        const user = await User.findById(userId);
        if (user) { user.Name = patch.Name; await user.save(); }
    }

    await profile.populate({ path: "user", select: "Name phoneNumber status role" });
    await profile.populate({ path: "assignedSalesperson", select: "Name email phoneNumber" });

    return {
        success: true,
        message: "Profile updated.",
        customer: buildAdminCustomerProfile(profile)
    };
};

module.exports = {

    getCustomers,

    getCustomerById,

    getMyCustomers,

    removeCustomer,

    updateMyProfile

};