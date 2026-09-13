const express = require("express");
const router = express.Router();

const messageController = require("../controllers/message.controller");
const authenticate = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/role.middleware");

router.post("/", authenticate, messageController.sendMessage);
router.get("/threads", authenticate, messageController.listThreads);
router.get("/thread/:otherUserId", authenticate, messageController.getThread);

// Admin oversight — see every conversation and read any thread
router.get("/admin/conversations", authenticate, authorize("admin"), messageController.listAllConversations);
router.get("/admin/thread/:userAId/:userBId", authenticate, authorize("admin"), messageController.getAnyThread);

module.exports = router;
