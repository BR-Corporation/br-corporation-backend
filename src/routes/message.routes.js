const express = require("express");
const router = express.Router();

const messageController = require("../controllers/message.controller");
const authenticate = require("../middlewares/auth.middleware");

router.post("/", authenticate, messageController.sendMessage);
router.get("/threads", authenticate, messageController.listThreads);
router.get("/thread/:otherUserId", authenticate, messageController.getThread);

module.exports = router;
