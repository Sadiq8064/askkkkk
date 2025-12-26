const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import routes
const universityAdminRoutes = require('./university_admin');
const studentRoutes = require('./student');
const accountRoutes = require('./accounts');   // ⬅ NEW
const askRoutes = require("./ask");
const developerRoutes = require('./developer');
// Initialize Express app
const app = express();




// 1. Increase general body-parser limits for JSON and URL-encoded data
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// 2. Increase the file size limit for multer (if used globally)
const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(), // Example, use your own storage
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for files
});



// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API Routes
app.use('/university', universityAdminRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/account', accountRoutes);     // ⬅ NEW
app.use("/api", askRoutes);
app.use('/developer', developerRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// Start server
const PORT = process.env.PORT || 3000;
// app.listen(PORT, "0.0.0.0", () => {
//     console.log('=================================================');
//     console.log('  University Management System API');
//     console.log('=================================================');
//     console.log(`  Server running on port ${PORT}`);
//     console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
//     console.log(`  Health check: http://localhost:${PORT}/health`);
//     console.log(`  API Documentation: http://localhost:${PORT}/`);
//     console.log('=================================================');
// });

module.exports = app;
