const swaggerJSDoc = require("swagger-jsdoc");
const path = require("path");

// Get the project root (Backend folder)
const projectRoot = path.resolve(__dirname, '../../');

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Quantification API",
      description: "API Documentation",
      version: "1.0.0",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    },
    servers: [
      {
        url: process.env.BASE_URL || "http://localhost:7001/api",
        description: "Local Server",
      },
    ],
  },
  apis: [
    // Use relative paths from project root
    "src/routes/**/*.js",
    "src/controller/**/*.js",
  ],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);
console.log('✅ Swagger paths found:', Object.keys(swaggerSpec.paths || {}));
module.exports = swaggerSpec;