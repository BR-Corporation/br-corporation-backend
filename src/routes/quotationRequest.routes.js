const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/quotationRequest.controller");
const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/role.middleware");

router.post("/", authenticate, authorize("customer", "salesperson", "admin"), ctrl.create);
router.get("/", authenticate, ctrl.list);
router.get("/:id", authenticate, ctrl.detail);
router.post("/:id/forward", authenticate, authorize("salesperson", "admin"), ctrl.forward);
router.post("/:id/reject", authenticate, authorize("salesperson", "manager", "admin"), ctrl.reject);

module.exports = router;
