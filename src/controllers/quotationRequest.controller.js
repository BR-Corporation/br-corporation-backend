const service = require("../services/quotationRequest.service");

const create = async (req, res, next) => {
    try {
        const result = await service.createRequest(req.body, req.user);
        return res.status(201).json(result);
    } catch (e) { next(e); }
};

const forward = async (req, res, next) => {
    try {
        const result = await service.forwardToManager(req.params.id, req.user, req.body.managerId);
        return res.status(200).json(result);
    } catch (e) { next(e); }
};

const reject = async (req, res, next) => {
    try {
        const result = await service.rejectRequest(req.params.id, req.user, req.body.reason);
        return res.status(200).json(result);
    } catch (e) { next(e); }
};

const list = async (req, res, next) => {
    try {
        const result = await service.listRequests(req.user, req.query);
        return res.status(200).json(result);
    } catch (e) { next(e); }
};

const detail = async (req, res, next) => {
    try {
        const result = await service.getRequestById(req.params.id, req.user);
        return res.status(200).json(result);
    } catch (e) { next(e); }
};

module.exports = { create, forward, reject, list, detail };
