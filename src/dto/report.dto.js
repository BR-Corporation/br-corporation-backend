// ----------------------------
// Report DTOs
// ----------------------------

const buildSalesReport = (report) => {

    if (!report) return null;

    return {

        totalSales: report.totalSales,

        totalRevenue: report.totalRevenue,

        returnedAmount: report.returnedAmount,

        totalOrders: report.totalOrders,

        averageOrderValue: report.averageOrderValue,

        salesByDate: report.salesByDate,

        salesBySalesperson: report.salesBySalesperson,

        salesByManager: report.salesByManager,

        salesByCustomer: report.salesByCustomer,

        salesByProduct: report.salesByProduct

    };

};

const buildCustomerReport = (report) => {

    if (!report) return null;

    return {

        totalCustomers: report.totalCustomers,

        customers: report.customers

    };

};

const buildProductReport = (report) => {

    if (!report) return null;

    return {

        totalProducts: report.totalProducts,

        products: report.products

    };

};

const buildInventoryReport = (report) => {

    if (!report) return null;

    return {

        totalProducts: report.totalProducts,

        lowStockProducts: report.lowStockProducts,

        outOfStockProducts: report.outOfStockProducts,

        inventoryMovements: report.inventoryMovements,

        bestSellingProducts: report.bestSellingProducts

    };

};

const buildPaymentReport = (report) => {

    if (!report) return null;

    return {

        totalPayments: report.totalPayments,

        grossCollected: report.grossCollected,

        totalRefunded: report.totalRefunded,

        totalCollected: report.totalCollected,

        totalOutstanding: report.totalOutstanding,

        overduePayments: report.overduePayments,

        payments: report.payments

    };

};

const buildSalespersonReport = (report) => {

    if (!report) return null;

    return {

        salespersonId: report.salespersonId,

        salespersonName: report.salespersonName,

        customers: report.customers,

        quotations: report.quotations,

        orders: report.orders,

        sales: report.sales,

        collections: report.collections,

        conversionRate: report.conversionRate

    };

};

const buildManagerReport = (report) => {

    if (!report) return null;

    return {

        managerId: report.managerId,

        managerName: report.managerName,

        teamSales: report.teamSales,

        teamOrders: report.teamOrders,

        teamQuotations: report.teamQuotations,

        teamCollections: report.teamCollections,

        teamConversionRate: report.teamConversionRate,

        salespersonReports: report.salespersonReports

    };

};

module.exports = {

    buildSalesReport,

    buildCustomerReport,

    buildProductReport,

    buildInventoryReport,

    buildPaymentReport,

    buildSalespersonReport,

    buildManagerReport

};
