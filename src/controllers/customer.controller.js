const customerService = require("../services/customer.service");
const authService = require("../services/auth.service");
const getCustomers = async (req, res, next) => {

    try {

        const result = await customerService.getCustomers(req.query, req.user);

        return res.status(200).json({

            success: true,

            ...result

        });

    } catch (error) {

        next(error);

    }

};
const getCustomerById = async (req, res, next) => {

    try {

        const { customerProfileId } = req.params;

       const customer = await customerService.getCustomerById(
    customerProfileId,
    req.user
);

        return res.status(200).json({
            success: true,
            customer
        });

    } catch (error) {

        next(error);

    }

};
const getMyCustomers = async (req, res, next) => {

    try {

        const customers = await customerService.getMyCustomers(
            req.user._id
        );

        return res.status(200).json({

            success: true,

            count: customers.length,

            customers

        });

    } catch (error) {

        next(error);

    }

};

const removeCustomer = async (req, res, next) => {

    try {

        const { customerProfileId } = req.params;

        const result = await customerService.removeCustomer(
            customerProfileId
        );

        return res.status(200).json(result);

    } catch (error) {

        next(error);

    }

};
const hardDeleteCustomer = async (req, res, next) => {
    try {
        const result = await authService.hardDeleteCustomer(req.params.customerProfileId);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

module.exports = {

    getCustomers,

    getCustomerById,

    getMyCustomers,

    removeCustomer,

    hardDeleteCustomer

};