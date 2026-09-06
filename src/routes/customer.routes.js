const express = require("express");

const customerController = require("../controllers/customer.controller");

const 
    authenticate
 = require("../middlewares/auth.middleware");

const 
    authorize
 = require("../middlewares/role.middleware");
const router = express.Router();
router.get(
    "/",
    authenticate,
    authorize("admin", "manager"),
    customerController.getCustomers
);

router.get(
    "/my-customers",
    authenticate,
    authorize("salesperson"),
    customerController.getMyCustomers
);

router.get(
    "/:customerProfileId",
    authenticate,
    authorize("admin", "manager", "salesperson", "customer"),
    customerController.getCustomerById
);

router.patch(
    "/:customerProfileId/remove",
    authenticate,
    authorize("admin"),
    customerController.removeCustomer
);

router.delete(
    "/:customerProfileId",
    authenticate,
    authorize("admin"),
    customerController.hardDeleteCustomer
);

module.exports = router;