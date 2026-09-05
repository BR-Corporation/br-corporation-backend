const authService = require("../services/auth.service");
const otpService = require("../services/otp.service");
const { successResponse } = require("../utils/response");
const sendOtp = async (req, res, next) => {

    try {

        const { phoneNumber } = req.body;

        const result = await otpService.sendOtp(phoneNumber);

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const verifyOtp = async (req, res, next) => {

    try {

        const { phoneNumber, otp } = req.body;

        const result = await otpService.verifyOtp(
            phoneNumber,
            otp
        );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const resendOtp = async (req, res, next) => {

    try {

        const { phoneNumber } = req.body;

        const result = await otpService.resendOtp(
            phoneNumber
        );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const registerCustomer = async (req, res, next) => {

    try {

        const result = await authService.registerCustomer(
            req.body
        );

        return res.status(201).json(result);

    } catch (error) {

        next(error);

    }

};
const loginCustomer = async (req, res, next) => {

    try {

        const { phoneNumber } = req.body;

        const result = await authService.loginCustomer(
            phoneNumber
        );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const loginEmployee = async (req, res, next) => {

    try {

        const { email, password } = req.body;

        const result = await authService.loginEmployee(
            email,
            password
        );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const changeTemporaryPassword = async (req, res, next) => {

    try {

        const {
            employeeId,
            currentPassword,
            newPassword
        } = req.body;

        const result =
            await authService.changeTemporaryPassword(
                employeeId,
                currentPassword,
                newPassword
            );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const createEmployee = async (req, res, next) => {

    try {

        const result =
            await authService.createEmployee(
                req.body
            );

        return res.status(201).json(result);

    } catch (error) {

        next(error);

    }

};
const approveCustomer = async (req, res, next) => {

    try {

        const { customerId } = req.body;

        const result =
            await authService.approveCustomer(
                customerId
            );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const getEmployeeActivity = async (req, res, next) => {
    try {
        const result = await authService.getEmployeeActivity(req.params.employeeId);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

const adminMarkCustomerOtpVerified = async (req, res, next) => {
    try {
        const { phoneNumber, enable } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, message: "phoneNumber is required." });
        }
        const shouldEnable = enable === false ? false : true;
        const result = await authService.adminMarkCustomerOtpVerified(phoneNumber, shouldEnable);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

const cleanupGhostCustomerUsers = async (_req, res, next) => {
    try {
        const result = await authService.cleanupGhostCustomerUsers();
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

const reactivateEmployee = async (req, res, next) => {
    try {
        const { employeeId } = req.params;
        const result = await authService.reactivateEmployee(employeeId);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

const updateCustomerStatus = async (req, res, next) => {
    try {
        const { customerId, status } = req.body;
        const result = await authService.updateCustomerStatus(customerId, status);
        return res.status(200).json({
            success: true,
            message: result.unchanged
                ? "Customer status unchanged."
                : `Customer status updated to ${status}.`,
            user: {
                id: result.user._id,
                Name: result.user.Name,
                status: result.user.status
            }
        });
    } catch (error) {
        next(error);
    }
};

const assignSalesperson = async (req, res, next) => {

    try {

        const {
            customerId,
            salespersonId
        } = req.body;

        const result =
            await authService.assignSalesperson(
                customerId,
                salespersonId
            );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const User = require("../models/user.model");

const getEmployees = async (req, res, next) => {
    try {
        const employees = await User.find({ role: { $in: ["salesperson", "manager", "admin"] } })
            .select("Name email phoneNumber role status mustChangePassword")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            employees
        });
    } catch (error) {
        next(error);
    }
};

const approveAndAssignCustomer = async (req, res, next) => {

    try {

        const {
            customerId,
            salespersonId
        } = req.body;

        const result =
            await authService.approveAndAssignCustomer(
                customerId,
                salespersonId
            );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};

const logout = async (req, res, next) => {

    try {

        const userId = req.user?._id;

        if (userId) {

            await authService.logout(userId);

        }

        return res.status(200).json({

            success: true,

            message: "Logout successful."

        });

    } catch (error) {

        next(error);

    }

};

const removeEmployee = async (req, res, next) => {

    try {

        const { employeeId } = req.params;

        const result = await authService.removeEmployee(
            employeeId,
            req.user._id
        );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};

module.exports = {

    sendOtp,

    verifyOtp,

    resendOtp,

    registerCustomer,

    loginCustomer,

    loginEmployee,

    changeTemporaryPassword,

    createEmployee,

    getEmployees,

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

};