// ----------------------------
// Salesperson Performance DTO
// ----------------------------

const buildSalespersonPerformance = (metrics) => {

    if (!metrics) return null;

    return {

        salespersonId: metrics.salespersonId,

        salespersonName: metrics.salespersonName,

        customers: {

            assigned: metrics.assignedCustomers,

            active: metrics.activeCustomers,

            new: metrics.newCustomers

        },

        followUps: {

            total: metrics.totalFollowUps,

            completed: metrics.completedFollowUps,

            pending: metrics.pendingFollowUps,

            overdue: metrics.overdueFollowUps

        },

        quotations: {

            created: metrics.totalQuotations,

            sent: metrics.sentQuotations,

            accepted: metrics.acceptedQuotations,

            rejected: metrics.rejectedQuotations,

            conversionRate: metrics.quotationConversionRate

        },

        orders: {

            created: metrics.totalOrders,

            completed: metrics.completedOrders,

            grossSales: metrics.grossSales,

            returnedAmount: metrics.returnedAmount,

            totalSales: metrics.totalSales,

            averageOrderValue: metrics.averageOrderValue

        },

        payments: {

            collected: metrics.totalPaymentsCollected,

            outstanding: metrics.totalOutstandingAmount

        },

        conversionRate: metrics.orderConversionRate

    };

};

// ----------------------------
// Salesperson Comparison DTO
// ----------------------------

const buildSalespersonComparison = (comparison) => {

    if (!comparison) return null;

    return {

        salespersonId: comparison.salespersonId,

        salespersonName: comparison.salespersonName,

        totalSales: comparison.totalSales,

        totalOrders: comparison.totalOrders,

        completedOrders: comparison.completedOrders,

        totalQuotations: comparison.totalQuotations,

        acceptedQuotations: comparison.acceptedQuotations,

        totalFollowUps: comparison.totalFollowUps,

        completedFollowUps: comparison.completedFollowUps,

        totalPaymentsCollected: comparison.totalPaymentsCollected,

        conversionRate: comparison.conversionRate,

        ranking: comparison.ranking

    };

};

// ----------------------------
// Salesperson Comparison List DTO
// ----------------------------

const buildSalespersonComparisonList = (comparisons = []) => {

    return comparisons.map(buildSalespersonComparison);

};

module.exports = {

    buildSalespersonPerformance,

    buildSalespersonComparison,

    buildSalespersonComparisonList

};
