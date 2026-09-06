const express = require("express");

const router = express.Router();

const authController = require("../controllers/auth.controller");
const {
    registerCustomerValidator,
    customerLoginValidator,
    employeeLoginValidator,
    changePasswordValidator
} = require("../validators/auth.validator");
const {
    createEmployeeValidator,
    approveCustomerValidator,
    assignSalespersonValidator,
    approveAndAssignValidator,
    removeEmployeeValidator,
    updateCustomerStatusValidator
} = require("../validators/admin.validator");

const validate = require("../middlewares/validation.middleware");
const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/role.middleware");
/********************************************************************
 * CUSTOMER AUTHENTICATION
 ********************************************************************/

router.post(
    "/customer/send-otp",
    authController.sendOtp
);

router.post(
    "/customer/verify-otp",
    authController.verifyOtp
);

router.post(
    "/customer/resend-otp",
    authController.resendOtp
);

router.post(
    "/register",
    registerCustomerValidator,
    validate,
    authController.registerCustomer
);

router.post(
    "/customer/login",
    customerLoginValidator,
    validate,
    authController.loginCustomer
);
/********************************************************************
 * EMPLOYEE AUTHENTICATION
 ********************************************************************/

router.post(
    "/employee/login",
    employeeLoginValidator,
    validate,
    authController.loginEmployee
);

router.patch(
    "/change-password",
    changePasswordValidator,
    validate,
    authController.changeTemporaryPassword
);
/********************************************************************
 * ADMIN OPERATIONS
 ********************************************************************/

router.get(
    "/admin/employees",
    authenticate,
    authorize("admin"),
    authController.getEmployees
);

router.post(
    "/admin/create-employee",
    authenticate,
    authorize("admin"),
    createEmployeeValidator,
    validate,
    authController.createEmployee
);

router.patch(
    "/admin/approve-customer",
    authenticate,
    authorize("admin"),
    approveCustomerValidator,
    validate,
    authController.approveCustomer
);

router.patch(
    "/admin/assign-salesperson",
    authenticate,
    authorize("admin"),
    assignSalespersonValidator,
    validate,
    authController.assignSalesperson
);

router.patch(
    "/admin/approve-and-assign",
    authenticate,
    authorize("admin"),
    approveAndAssignValidator,
    validate,
    authController.approveAndAssignCustomer
);

router.post(
    "/admin/mark-customer-verified",
    authenticate,
    authorize("admin"),
    authController.adminMarkCustomerOtpVerified
);

router.post(
    "/admin/cleanup-ghost-users",
    authenticate,
    authorize("admin"),
    authController.cleanupGhostCustomerUsers
);

router.patch(
    "/admin/customer-status",
    authenticate,
    authorize("admin"),
    updateCustomerStatusValidator,
    validate,
    authController.updateCustomerStatus
);

router.get(
    "/admin/employees/:employeeId/activity",
    authenticate,
    authorize("admin"),
    removeEmployeeValidator,
    validate,
    authController.getEmployeeActivity
);

router.delete(
    "/admin/employees/:employeeId",
    authenticate,
    authorize("admin"),
    removeEmployeeValidator,
    validate,
    authController.hardDeleteEmployee
);

router.patch(
    "/admin/employees/:employeeId/reactivate",
    authenticate,
    authorize("admin"),
    removeEmployeeValidator,
    validate,
    authController.reactivateEmployee
);

router.patch(
    "/admin/employees/:employeeId/remove",
    authenticate,
    authorize("admin"),
    removeEmployeeValidator,
    validate,
    authController.removeEmployee
);

router.post(
    "/logout",
    authenticate,
    authController.logout
);

module.exports = router;