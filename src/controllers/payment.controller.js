const paymentService = require("../services/payment.service");

// ----------------------------
// Create Payment
// ----------------------------

const createPayment = async (req, res, next) => {

    try {

        const result = await paymentService.createPayment(req.body, req.user);

        return res.status(201).json(result);

    } catch (error) {

        next(error);

    }

};

// ----------------------------
// Get Payments
// ----------------------------

const getPayments = async (req, res, next) => {

    try {

        const result = await paymentService.getPayments(req.query, req.user);

        return res.status(200).json({

            success: true,

            ...result

        });

    } catch (error) {

        next(error);

    }

};

// ----------------------------
// Get Customer Payments
// ----------------------------

const getCustomerPayments = async (req, res, next) => {

    try {

        const { customerProfileId } = req.params;

        const result = await paymentService.getCustomerPayments(customerProfileId, req.user);

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};

// ----------------------------
// Get Order Payments
// ----------------------------

const getOrderPayments = async (req, res, next) => {

    try {

        const { orderId } = req.params;

        const result = await paymentService.getOrderPayments(orderId, req.user);

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};

const deletePayment = async (req, res, next) => {
    try {
        const result = await paymentService.deletePayment(req.params.paymentId, req.user);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports = {

    createPayment,

    getPayments,

    getCustomerPayments,

    getOrderPayments,

    deletePayment

};
