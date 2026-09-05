const {
    buildEmployeeProfile
} = require("../dto/user.dto");
const User = require("../models/user.model");
const CustomerProfile = require("../models/customerProfile.model");
const  BusinessError  = require("../utils/errors/businessError"); 
const { generateAccessToken } = require("../utils/jwt"); 
const generateTemporaryPassword = require("../utils/generateTemporaryPassword");
const {
    sendEmployeeWelcomeEmail
} = require("./email.service");
const {

    buildCustomerProfile,

    buildSalespersonCustomerProfile,

    buildAdminCustomerProfile

} = require("../dto/customer.dto");

const { createInternalActivity } = require("./customerActivity.service");


const registerCustomer = async (customerData) => {

    const {
        Name,
        phoneNumber,
        businessName,
        businessType,
        address,
        city,
        state,
        pincode
    } = customerData;

    const existingCustomer = await User.findByPhoneNumber(phoneNumber);

    if (existingCustomer) {
        throw new BusinessError("Customer already exists.", 409);
    }

    const customer = await User.create({

        Name,

        phoneNumber,

        role: "customer"

    });

    const customerProfile = await CustomerProfile.create({

        user: customer._id,

        businessName,

        businessType,

        address,

        city,

        state,

        pincode

    });

    await createInternalActivity({

        customerProfileId: customerProfile._id,

        createdBy: customer._id,

        activityType: "system",

        title: "Customer Registered",

        description: `Customer ${Name} registered successfully.`,

        metadata: {

            customerId: customer._id,

            businessName

        }

    });

    return {

        success: true,

        message: "Registration successful. Waiting for admin approval.",

        customerId: customer._id

    };

};

const loginCustomer = async (phoneNumber) => {

    const customer = await User.findByPhoneNumber(phoneNumber);

    if (!customer) {

        throw new BusinessError(

            "Customer not found. Please register first.",

            404

        );

    }

    if (customer.role !== "customer") {

        throw new BusinessError(

            "Customer not found. Please register first.",

            404

        );

    }

    if (customer.status === "pending") {

        throw new BusinessError(

            "Your account is waiting for admin approval.",

            403

        );

    }

    if (customer.status === "suspended") {

        throw new BusinessError(

            "Your account has been blocked. Please contact the administrator.",

            403

        );

    }

    if (!customer.otpVerified && !customer.otpBypass) {

        throw new BusinessError(

            "Please verify OTP before logging in.",

            403

        );

    }

    const profile = await CustomerProfile.findOne({

        user: customer._id

    });

    // Ghost user guard: a customer User must have a CustomerProfile.
    // Left-over users from partial registrations get self-cleaned here.
    if (!profile) {
        await User.deleteOne({ _id: customer._id });
        throw new BusinessError(
            "Customer profile not found. Please register again.",
            404
        );
    }

    const token = generateAccessToken({

        userId: customer._id,

        role: customer.role

    });

    const profileResponse =
        buildCustomerProfile(profile);

    // Only reset otpVerified for customers who need the regular OTP flow.
    // otpBypass customers stay logged-in-eligible indefinitely (admin-managed).
    if (!customer.otpBypass) {
        customer.otpVerified = false;
        await customer.save();
    }

   return {
    success: true,
    message: "Login successful.",
    token,
    user: {
    id: customer._id,
    Name: customer.Name,
    role: customer.role
    },
    customerProfileId: profile ? profile._id : null
   };

};

const loginEmployee = async (email, password) => {
    const employee = await User.findByEmail(email).select("+password");

    if (!employee) {
        throw new BusinessError("Invalid email or password.", 401);
    }

    // FIXED: Validation now runs BEFORE generating tokens or processing logic
    if (!["admin", "manager", "salesperson"].includes(employee.role)) {
        throw new BusinessError("Unauthorized login method.", 403);
    }

    const isMatch = await employee.comparePassword(password);
    if (!isMatch) {
        throw new BusinessError("Invalid email or password.", 401);
    }

    if (employee.status === "suspended") {
        throw new BusinessError("Your account has been blocked.", 403);
    }

    if (employee.mustChangePassword) {
        return {
            success: true,
            changePasswordRequired: true,
            employeeId: employee._id,
            message: "Please change your temporary password."
        };
    }

    const token = generateAccessToken({
        userId: employee._id,
        role: employee.role
    });

    return {
        success: true,
        message: "Login successful.",
        token,
        user: {
            id: employee._id,
            Name: employee.Name,
            role: employee.role
        }
    };
};

const changeTemporaryPassword = async (employeeId, currentPassword, newPassword) => {
    const employee = await User.findById(employeeId).select("+password");

    if (!employee) {
        throw new BusinessError("Employee not found.", 404);
    }

    // FIXED: Moved from the bottom to the top to guard against multi-invocations
    if (!employee.mustChangePassword) {
        throw new BusinessError("Password has already been changed.", 400);
    }

    const isMatch = await employee.comparePassword(currentPassword);
    if (!isMatch) {
        throw new BusinessError("Current password is incorrect.", 401);
    }

    const isSamePassword = await employee.comparePassword(newPassword);
    if (isSamePassword) {
        throw new BusinessError("New password cannot be the same as the current password.", 400);
    }

    employee.password = newPassword;
    employee.mustChangePassword = false;
    await employee.save();

    const token = generateAccessToken({
        userId: employee._id,
        role: employee.role
    });

    return {
        success: true,
        message: "Password changed successfully.",
        token,
        user: buildEmployeeProfile(employee)
    };
};

const createEmployee = async (employeeData) => {
    const { Name, email, phoneNumber, role } = employeeData;

    if (!["manager", "salesperson"].includes(role)) {
        throw new BusinessError("Invalid employee role.", 400);
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
        throw new BusinessError("Email already exists.", 409);
    }

    const existingPhone = await User.findByPhoneNumber(phoneNumber);
    if (existingPhone) {
        throw new BusinessError("Phone number already exists.", 409);
    }

    const temporaryPassword = generateTemporaryPassword();

   const employee = await User.create({
    Name,
    email,
    phoneNumber,
    password: temporaryPassword,
    role
});

// Send welcome email (don't fail employee creation if email fails)
try {

    await sendEmployeeWelcomeEmail({
        Name,
        email,
        temporaryPassword
    });

} catch (error) {

    console.error("Failed to send welcome email:", error.message);

}

return {
    success: true,
    message: "Employee created successfully.",
    employeeId: employee._id,
    temporaryPassword
};
};
// REMOVED: adminUser parameter and role verification check
const approveCustomer = async (customerId, options = { save: true }) => {
    const customer = await User.findById(customerId);
    if (!customer) {
        throw new BusinessError("Customer not found.", 404);
    }

    if (customer.role !== "customer") {
        throw new BusinessError("Selected user is not a customer.", 400);
    }

    if (customer.isApproved()) {
        throw new BusinessError("Customer is already approved.", 400);
    }

    customer.status = "approved";

    if (options.save) {
        await customer.save();
    }

    const profile = await CustomerProfile.findOne({ user: customerId });

    if (profile) {
        await createInternalActivity({
            customerProfileId: profile._id,
            createdBy: customerId,
            activityType: "system",
            title: "Customer Approved",
            description: `Customer ${customer.Name} has been approved.`,
            metadata: {
                customerId: customer._id,
                status: "approved"
            }
        });
    }

    return customer;
};

const updateCustomerStatus = async (customerId, newStatus) => {
    const allowed = ["approved", "suspended"];
    if (!allowed.includes(newStatus)) {
        throw new BusinessError(
            "Invalid status. Allowed: approved, suspended.",
            400
        );
    }
    const customer = await User.findById(customerId);
    if (!customer) {
        throw new BusinessError("Customer not found.", 404);
    }
    if (customer.role !== "customer") {
        throw new BusinessError("Selected user is not a customer.", 400);
    }
    if (customer.status === "pending") {
        throw new BusinessError(
            "Pending customers must be approved via the approve endpoint.",
            400
        );
    }
    if (customer.status === newStatus) {
        return { user: customer, unchanged: true };
    }

    const oldStatus = customer.status;
    customer.status = newStatus;
    await customer.save();

    const profile = await CustomerProfile.findOne({ user: customerId });
    if (profile) {
        await createInternalActivity({
            customerProfileId: profile._id,
            createdBy: customerId,
            activityType: "system",
            title: newStatus === "suspended" ? "Customer Suspended" : "Customer Reinstated",
            description: `Customer ${customer.Name} status changed from ${oldStatus} to ${newStatus}.`,
            metadata: {
                customerId: customer._id,
                oldStatus,
                newStatus
            }
        });
    }
    return { user: customer };
};

// REMOVED: adminUser parameter and role verification check
const assignSalesperson = async (customerId, salespersonId, options = { save: true }) => {
    const customer = await User.findById(customerId);
    if (!customer) {
        throw new BusinessError("Customer not found.", 404);
    }

    const salesperson = await User.findById(salespersonId);
    if (!salesperson) {
        throw new BusinessError("Salesperson not found.", 404);
    }

    if (salesperson.role !== "salesperson") {
        throw new BusinessError("Selected employee is not a salesperson.", 400);
    }

   const profile = await CustomerProfile.findOne({

    user: customerId

});

if (!profile) {

    throw new BusinessError("Customer profile not found.",404);

}

profile.assignedSalesperson = salesperson._id;

if(options.save){

    await profile.save();

}

await createInternalActivity({

    customerProfileId: profile._id,

    createdBy: customerId,

    activityType: "system",

    title: "Salesperson Assigned",

    description: `Salesperson ${salesperson.Name} assigned to customer ${customer.Name}.`,

    metadata: {

        customerId: customer._id,

        salespersonId: salesperson._id,

        salespersonName: salesperson.Name

    }

});

return profile;
};

// REMOVED: adminUser parameter and role verification check
const approveAndAssignCustomer = async (customerId, salespersonId) => {
    // Call internal operations cleanly without passing an admin context
    const customer = await approveCustomer(customerId,{save:false});

    const profile = await assignSalesperson(

    customerId,

    salespersonId,

    {save:false}

);

await customer.save();

await profile.save();

    const salesperson = await User.findById(salespersonId);

    return {
        success: true,
        message: "Customer approved and salesperson assigned successfully.",
        customer: {
            id: customer._id,
            Name: customer.Name,
            businessName: profile.businessName,
            status: customer.status,
            assignedSalesperson: {
                id: salesperson._id,
                Name: salesperson.Name
            }
        }
    };
};

const logout = async (userId) => {

    await User.findByIdAndUpdate(userId, { otpVerified: false });

};

/**
 * Admin bypass: toggle a customer's persistent OTP bypass on or off.
 * ON  — customer can log in freely with just their phone number (no OTP).
 * OFF — normal OTP flow applies again.
 * Use when SMS delivery is blocked (Twilio trial, DLT pending, etc.) and
 * admin has verified the customer's identity out-of-band.
 */
const adminMarkCustomerOtpVerified = async (phoneNumber, enable = true) => {
    const Otp = require("../models/otp.model");
    const customer = await User.findOne({ phoneNumber, role: "customer" });
    if (!customer) {
        throw new BusinessError("Customer not found for that phone.", 404);
    }
    if (customer.status === "pending") {
        throw new BusinessError("Approve the customer first.", 400);
    }
    if (customer.status === "suspended") {
        throw new BusinessError("Cannot verify a suspended customer.", 400);
    }
    customer.otpBypass = Boolean(enable);
    // If we're enabling, also flip otpVerified so an in-flight login succeeds
    if (enable) customer.otpVerified = true;
    await customer.save();
    // Clear any lingering OTP doc so future normal OTP flow starts clean
    await Otp.deleteMany({ phoneNumber });
    return {
        success: true,
        message: enable
            ? `${customer.Name} can now sign in without OTP. Turn off when SMS is working.`
            : `OTP bypass removed for ${customer.Name}. They'll need OTP on next login.`,
        customer: {
            id: customer._id,
            Name: customer.Name,
            phoneNumber: customer.phoneNumber,
            otpBypass: customer.otpBypass
        }
    };
};

const cleanupGhostCustomerUsers = async () => {
    // 1. Customer Users without a CustomerProfile
    const customerUsers = await User.find({ role: "customer" }).select("_id Name phoneNumber");
    const profiles = await CustomerProfile.find({}).select("_id user businessName");
    const usersWithProfile = new Set(
        profiles.filter((p) => p.user).map((p) => p.user.toString())
    );

    const orphanUsers = customerUsers.filter((u) => !usersWithProfile.has(u._id.toString()));

    // 2. CustomerProfiles whose linked User no longer exists
    const validUserIds = new Set(customerUsers.map((u) => u._id.toString()));
    const orphanProfiles = profiles.filter(
        (p) => !p.user || !validUserIds.has(p.user.toString())
    );

    if (orphanUsers.length === 0 && orphanProfiles.length === 0) {
        return {
            success: true,
            removedUsers: 0,
            removedProfiles: 0,
            message: "No ghost customer records found."
        };
    }

    if (orphanUsers.length > 0) {
        await User.deleteMany({ _id: { $in: orphanUsers.map((u) => u._id) } });
    }
    if (orphanProfiles.length > 0) {
        await CustomerProfile.deleteMany({ _id: { $in: orphanProfiles.map((p) => p._id) } });
    }

    return {
        success: true,
        removedUsers: orphanUsers.length,
        removedProfiles: orphanProfiles.length,
        message:
            `Removed ${orphanUsers.length} ghost user(s) and ${orphanProfiles.length} orphan profile(s).`,
        details: {
            users: orphanUsers.map((u) => ({ id: u._id, Name: u.Name, phoneNumber: u.phoneNumber })),
            profiles: orphanProfiles.map((p) => ({ id: p._id, businessName: p.businessName }))
        }
    };
};

const getEmployeeActivity = async (employeeId) => {
    const employee = await User.findById(employeeId)
        .select("Name email phoneNumber role status managerId createdAt");
    if (!employee) {
        throw new BusinessError("Employee not found.", 404);
    }
    if (employee.role === "customer") {
        throw new BusinessError("Selected user is not an employee.", 400);
    }

    const InventoryMovement = require("../models/inventoryMovement.model");
    const CustomerActivity = require("../models/customerActivity.model");
    const FollowUp = require("../models/followUp.model");
    const Order = require("../models/order.model");
    const Quotation = require("../models/quotation.model");
    const Payment = require("../models/payment.model");
    const CustomerProfile = require("../models/customerProfile.model");

    const [
        assignedCustomers,
        inventoryMovements,
        activities,
        orders,
        quotations,
        payments,
        followUps
    ] = await Promise.all([
        // Only meaningful for salesperson but we return it either way when applicable
        CustomerProfile.find({ assignedSalesperson: employeeId })
            .populate({ path: "user", select: "Name phoneNumber status" })
            .select("businessName city customerStage totalOrders totalRevenue outstandingAmount lastContactedAt user")
            .sort("-createdAt")
            .limit(100),
        InventoryMovement.find({ performedBy: employeeId })
            .populate({ path: "product", select: "name SKU" })
            .sort("-createdAt")
            .limit(100),
        CustomerActivity.find({ createdBy: employeeId })
            .populate({
                path: "customerProfile",
                select: "businessName user",
                populate: { path: "user", select: "Name" }
            })
            .sort("-createdAt")
            .limit(100),
        Order.find({ createdBy: employeeId })
            .populate({ path: "customerProfile", select: "businessName" })
            .select("orderStatus paymentStatus grandTotal createdAt customerProfile")
            .sort("-createdAt")
            .limit(50),
        Quotation.find({ createdBy: employeeId })
            .populate({ path: "customerProfile", select: "businessName" })
            .select("status grandTotal createdAt customerProfile")
            .sort("-createdAt")
            .limit(50),
        Payment.find({ createdBy: employeeId })
            .populate({ path: "customerProfile", select: "businessName" })
            .populate({ path: "orderId", select: "grandTotal" })
            .select("amount paymentMethod paymentDate transactionReference customerProfile orderId createdAt")
            .sort("-createdAt")
            .limit(50),
        FollowUp.find({ createdBy: employeeId })
            .populate({ path: "customerProfile", select: "businessName" })
            .select("title status priority followUpDate taskType customerProfile createdAt completedAt")
            .sort("-createdAt")
            .limit(50)
    ]);

    // Totals for header
    const totals = {
        assignedCustomers: assignedCustomers.length,
        inventoryMovements: inventoryMovements.length,
        activities: activities.length,
        orders: orders.length,
        quotations: quotations.length,
        payments: payments.length,
        followUps: followUps.length,
        paymentsAmount: payments.reduce((s, p) => s + (p.amount || 0), 0),
        ordersAmount: orders.reduce((s, o) => s + (o.grandTotal || 0), 0)
    };

    return {
        success: true,
        employee: {
            id: employee._id,
            Name: employee.Name,
            email: employee.email,
            phoneNumber: employee.phoneNumber,
            role: employee.role,
            status: employee.status,
            managerId: employee.managerId,
            createdAt: employee.createdAt
        },
        totals,
        assignedCustomers: assignedCustomers.map((c) => ({
            id: c._id,
            businessName: c.businessName,
            city: c.city,
            customerStage: c.customerStage,
            totalOrders: c.totalOrders,
            totalRevenue: c.totalRevenue,
            outstandingAmount: c.outstandingAmount,
            lastContactedAt: c.lastContactedAt,
            customerName: c.user?.Name,
            phoneNumber: c.user?.phoneNumber
        })),
        inventoryMovements: inventoryMovements.map((m) => ({
            id: m._id,
            type: m.type,
            quantity: m.quantity,
            previousStock: m.previousStock,
            newStock: m.newStock,
            reason: m.reason,
            reference: m.reference,
            productName: m.product?.name,
            productSKU: m.product?.SKU,
            createdAt: m.createdAt
        })),
        customerActivities: activities.map((a) => ({
            id: a._id,
            activityType: a.activityType,
            title: a.title,
            description: a.description,
            customerBusinessName: a.customerProfile?.businessName,
            customerName: a.customerProfile?.user?.Name,
            createdAt: a.createdAt
        })),
        orders: orders.map((o) => ({
            id: o._id,
            customerBusinessName: o.customerProfile?.businessName,
            orderStatus: o.orderStatus,
            paymentStatus: o.paymentStatus,
            grandTotal: o.grandTotal,
            createdAt: o.createdAt
        })),
        quotations: quotations.map((q) => ({
            id: q._id,
            customerBusinessName: q.customerProfile?.businessName,
            status: q.status,
            grandTotal: q.grandTotal,
            createdAt: q.createdAt
        })),
        payments: payments.map((p) => ({
            id: p._id,
            customerBusinessName: p.customerProfile?.businessName,
            amount: p.amount,
            paymentMethod: p.paymentMethod,
            paymentDate: p.paymentDate,
            transactionReference: p.transactionReference,
            orderId: p.orderId?._id || p.orderId,
            createdAt: p.createdAt
        })),
        followUps: followUps.map((f) => ({
            id: f._id,
            title: f.title,
            status: f.status,
            priority: f.priority,
            taskType: f.taskType,
            followUpDate: f.followUpDate,
            completedAt: f.completedAt,
            customerBusinessName: f.customerProfile?.businessName,
            createdAt: f.createdAt
        }))
    };
};

const reactivateEmployee = async (employeeId) => {
    const employee = await User.findById(employeeId);
    if (!employee) {
        throw new BusinessError("Employee not found.", 404);
    }
    if (employee.role === "customer") {
        throw new BusinessError("Selected user is not an employee.", 400);
    }
    if (employee.status !== "suspended") {
        throw new BusinessError("Employee is not suspended.", 400);
    }
    employee.status = "approved";
    await employee.save();
    return {
        success: true,
        message: "Employee reactivated successfully.",
        employee: {
            id: employee._id,
            Name: employee.Name,
            status: employee.status
        }
    };
};

const removeEmployee = async (employeeId, requesterId) => {
    const employee = await User.findById(employeeId);
    if (!employee) {
        throw new BusinessError("Employee not found.", 404);
    }

    if (employee.role === "customer") {
        throw new BusinessError("Selected user is not an employee.", 400);
    }

    if (employee.status === "suspended") {
        throw new BusinessError("Employee is already suspended.", 400);
    }

    if (employee._id.toString() === requesterId.toString()) {
        throw new BusinessError("You cannot deactivate your own account.", 400);
    }

    const adminCount = await User.countDocuments({
        role: "admin",
        status: { $ne: "suspended" }
    });

    if (employee.role === "admin" && adminCount <= 1) {
        throw new BusinessError("Cannot deactivate the last active admin.", 400);
    }

    const assignedCustomers = await CustomerProfile.find({
        assignedSalesperson: employeeId
    }).select("_id");

    if (assignedCustomers.length > 0) {
        throw new BusinessError(
            `Cannot deactivate employee. ${assignedCustomers.length} customer(s) are currently assigned. Reassign these customers first.`,
            400
        );
    }

    employee.status = "suspended";
    await employee.save();

    return {
        success: true,
        message: "Employee has been suspended successfully."
    };
};

module.exports = {
    registerCustomer,
    loginCustomer,
    loginEmployee,
    changeTemporaryPassword,
    createEmployee,
    approveCustomer,
    assignSalesperson,
    approveAndAssignCustomer,
    logout,
    removeEmployee,
    reactivateEmployee,
    updateCustomerStatus,
    cleanupGhostCustomerUsers,
    getEmployeeActivity,
    adminMarkCustomerOtpVerified
}