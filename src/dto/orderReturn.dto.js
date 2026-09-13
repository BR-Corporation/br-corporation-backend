// ----------------------------
// Order Return Item DTO
// ----------------------------

const buildOrderReturnItem = (item) => {

    if (!item) return null;

    return {

        id: item._id,

        product: item.product,

        productName: item.productName,

        quantity: item.quantity,

        unitPrice: item.unitPrice,

        lineTotal: item.lineTotal

    };

};

// ----------------------------
// Order Return Detail DTO
// ----------------------------

const buildOrderReturnDetail = (orderReturn) => {

    if (!orderReturn) return null;

    return {

        id: orderReturn._id,

        orderId: orderReturn.order,

        customerProfileId: orderReturn.customerProfile,

        items: orderReturn.items?.map(buildOrderReturnItem) || [],

        returnType: orderReturn.returnType,

        reason: orderReturn.reason,

        status: orderReturn.status,

        createdBy: orderReturn.createdBy,

        createdAt: orderReturn.createdAt,

        updatedAt: orderReturn.updatedAt

    };

};

// ----------------------------
// Order Return Summary DTO
// ----------------------------

const buildOrderReturnSummary = (orderReturn) => {

    if (!orderReturn) return null;

    const items = (orderReturn.items || []).map(buildOrderReturnItem);

    const totalValue = items.reduce((s, i) => s + (i.lineTotal || 0), 0);

    return {

        id: orderReturn._id,

        orderId: orderReturn.order,

        customerProfileId: orderReturn.customerProfile,

        items,

        totalValue,

        returnType: orderReturn.returnType,

        reason: orderReturn.reason,

        status: orderReturn.status,

        createdAt: orderReturn.createdAt,

        updatedAt: orderReturn.updatedAt

    };

};

// ----------------------------
// Order Return List DTO
// ----------------------------

const buildOrderReturnList = (orderReturns = []) => {

    return orderReturns.map(buildOrderReturnSummary);

};

module.exports = {

    buildOrderReturnItem,

    buildOrderReturnDetail,

    buildOrderReturnSummary,

    buildOrderReturnList

};
