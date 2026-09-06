const swaggerJsdoc = require("swagger-jsdoc");

const options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "BR Corporation API",
            version: "1.0.0",
            description: "REST API Documentation for BR Corporation"
        },
        servers: [
            {
                url: "http://localhost:5000",
                description: "Development Server"
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "Enter only the JWT token. Swagger automatically adds 'Bearer'."
                }
                }
            }
        
    },

    apis: [
        "./src/docs/swagger/*.js"
    ]
};


module.exports = swaggerJsdoc(options);