const messageService = require("../services/message.service");

const sendMessage = async (req, res, next) => {
    try {
        const { toUserId, text } = req.body;
        if (!toUserId) return res.status(400).json({ success: false, message: "toUserId required." });
        const result = await messageService.sendMessage({ from: req.user, toUserId, text });
        return res.status(201).json({ success: true, message: result });
    } catch (error) { next(error); }
};

const getThread = async (req, res, next) => {
    try {
        const result = await messageService.getThread(req.user, req.params.otherUserId);
        return res.status(200).json(result);
    } catch (error) { next(error); }
};

const listThreads = async (req, res, next) => {
    try {
        const result = await messageService.listThreads(req.user);
        return res.status(200).json(result);
    } catch (error) { next(error); }
};

module.exports = { sendMessage, getThread, listThreads };
