const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const http = require('http');
const https = require('https');
const cookieParser = require('cookie-parser');

// Import authentication middleware
const { 
    basicAuth, 
    sessionAuth, 
    adminAuth, 
    handleLogin,
    isAdminConfigured,
    getUserRole,
    isAdmin 
} = require('./middleware/auth');

const app = express();
const httpPort = process.env.HTTP_PORT || 3000;
const httpsPort = process.env.HTTPS_PORT || 3443;

// System Configuration
let systemConfig = {
    securityMode: process.env.SECURITY_MODE || 'disabled', // 'prevent', 'logOnly', or 'disabled'
};

// Store scan results in memory
let scanResults = [];

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: './uploads',
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage: storage });

// Trust proxy - needed for running behind load balancer
app.set('trust proxy', 1);

// Add cookie parser middleware
app.use(cookieParser());

// Session middleware
app.use(session({
    secret: 'hackedvault-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Will be set dynamically based on protocol
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: 'lax'
    },
    name: 'hackedvault.sid', // Custom session cookie name
    proxy: true // Trust the reverse proxy
}));

// Middleware to handle secure cookies behind proxy
app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        req.session.cookie.secure = true;
    }
    next();
});

// Combined auth middleware
const combinedAuth = (req, res, next) => {
    // Check for Basic Auth header
    const authHeader = req.headers.authorization;
    if (authHeader) {
        return basicAuth(req, res, next);
    }
    // If no Basic Auth, check session
    if (req.session && req.session.user) {
        req.user = req.session.user;
        return next();
    }
    // If neither, redirect to login
    res.redirect('/login');
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store scan result
const storeScanResult = (result) => {
    scanResults.unshift(result);
    if (scanResults.length > 100) {
        scanResults = scanResults.slice(0, 100);
    }
};

// API Endpoints - Move to /api prefix
app.post('/api/upload', (req, res, next) => {
    // Run basic auth first
    basicAuth(req, res, () => {
        // After auth passes, run multer
        upload.array('file')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: 'File upload error' });
            }

            try {
                if (!req.files || req.files.length === 0) {
                    return res.status(400).json({ error: 'No files uploaded' });
                }

                const responses = [];
                
                // Process each file
                for (const file of req.files) {
                    const filePath = path.join('./uploads', file.filename);

                    try {
                        // Skip scanning if security mode is disabled
                        if (systemConfig.securityMode === 'disabled') {
                            const scanRecord = {
                                filename: file.originalname,
                                size: file.size,
                                mimetype: file.mimetype,
                                isSafe: null,  // Set to null for not scanned
                                scanId: `SCAN_DISABLED_${Date.now()}`,
                                tags: ['scan_disabled'],
                                timestamp: new Date(),
                                securityMode: systemConfig.securityMode,
                                action: 'Uploaded without scanning',
                                fileStatus: 'Saved',
                                uploadedBy: req.user.username
                            };
                            
                            storeScanResult(scanRecord);
                            responses.push({ 
                                file: file.originalname,
                                status: 'success',
                                message: 'File uploaded successfully (scanning disabled)',
                                scanResult: {
                                    isSafe: null,
                                    message: 'Scanning disabled'
                                }
                            });
                            continue;
                        }
                        
                        // Normal scanning process
                        const fileData = fs.readFileSync(filePath);
                        
                        try {
                            const scanResponse = await axios.post('http://localhost:3001/scan', fileData, {
                                headers: {
                                    'Content-Type': 'application/octet-stream',
                                    'X-Filename': file.originalname
                                }
                            });

                            const scanResult = JSON.parse(scanResponse.data.message);
                            const isMalwareFound = scanResult.scanResult === 1 || (scanResult.foundMalwares && scanResult.foundMalwares.length > 0);
                            
                            // Store scan result
                            const scanRecord = {
                                filename: file.originalname,
                                size: file.size,
                                mimetype: file.mimetype,
                                isSafe: !isMalwareFound,
                                scanId: scanResponse.data.scanId,
                                tags: scanResponse.data.tags || [],
                                timestamp: new Date(),
                                securityMode: systemConfig.securityMode,
                                action: isMalwareFound ? 
                                    (systemConfig.securityMode === 'prevent' ? 'Malware detected and blocked' : 'Malware detected and logged') :
                                    'Scanned and verified safe',
                                fileStatus: isMalwareFound && systemConfig.securityMode === 'prevent' ? 'Deleted' : 'Saved',
                                uploadedBy: req.user.username,
                                scanDetails: scanResult
                            };
                            
                            if (isMalwareFound) {
                                // Handle malware based on security mode
                                if (systemConfig.securityMode === 'prevent') {
                                    fs.unlinkSync(filePath);
                                    storeScanResult(scanRecord);
                                    responses.push({
                                        file: file.originalname,
                                        status: 'error',
                                        error: 'Malware detected - Upload prevented',
                                        details: scanResponse.data.message,
                                        scanId: scanResponse.data.scanId
                                    });
                                } else {
                                    // Log Only mode - keep file but mark as unsafe
                                    storeScanResult(scanRecord);
                                    responses.push({
                                        file: file.originalname,
                                        status: 'warning',
                                        message: 'File uploaded but marked as unsafe',
                                        warning: 'Malware detected',
                                        scanResult: scanResponse.data
                                    });
                                }
                            } else {
                                // Safe file handling
                                storeScanResult(scanRecord);
                                responses.push({
                                    file: file.originalname,
                                    status: 'success',
                                    message: 'File uploaded and scanned successfully',
                                    scanResult: scanResponse.data
                                });
                            }

                        } catch (scanError) {
                            // Delete file on scan error
                            fs.unlinkSync(filePath);
                            console.error('Scan error:', scanError);
                            responses.push({
                                file: file.originalname,
                                status: 'error',
                                error: 'File scan failed',
                                details: scanError.message
                            });
                        }
                    } catch (fileError) {
                        console.error('File processing error:', fileError);
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                        responses.push({
                            file: file.originalname,
                            status: 'error',
                            error: 'File processing failed'
                        });
                    }
                }

                // Send combined response
                res.json({
                    message: 'File upload processing complete',
                    results: responses
                });

            } catch (error) {
                console.error('Upload error:', error);
                res.status(500).json({ error: 'File upload failed' });
            }
        });
    });
});

app.get('/api/files', basicAuth, (req, res) => {
    try {
        fs.readdir('./uploads', (err, files) => {
            if (err) {
                return res.status(500).json({ error: 'Error reading files' });
            }
            const fileList = files.map(filename => {
                const stats = fs.statSync(path.join('./uploads', filename));
                return {
                    name: filename,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            });
            res.json(fileList);
        });
    } catch (error) {
        console.error('File listing error:', error);
        res.status(500).json({ error: 'Error listing files' });
    }
});

app.delete('/api/files/:filename', basicAuth, (req, res) => {
    try {
        const filepath = path.join('./uploads', req.params.filename);
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        fs.unlink(filepath, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Error deleting file' });
            }
            scanResults = scanResults.filter(result => result.filename !== req.params.filename);
            res.json({ message: 'File deleted successfully' });
        });
    } catch (error) {
        console.error('File deletion error:', error);
        res.status(500).json({ error: 'Error deleting file' });
    }
});

// Configuration endpoints with combined auth
app.get('/config', combinedAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'configuration.html'));
});

app.get('/api/config', combinedAuth, (req, res) => {
    res.json({
        ...systemConfig,
        isAdmin: isAdmin(req),
        adminConfigured: isAdminConfigured()
    });
});

app.post('/api/config', combinedAuth, adminAuth, (req, res) => {
    const { securityMode } = req.body;
    
    if (securityMode && ['prevent', 'logOnly', 'disabled'].includes(securityMode)) {
        systemConfig.securityMode = securityMode;
        res.json({ message: 'Configuration updated', config: systemConfig });
    } else {
        res.status(400).json({ error: 'Invalid configuration' });
    }
});

app.get('/api/health', basicAuth, (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        securityMode: systemConfig.securityMode,
        scanResults: {
            total: scanResults.length,
            safe: scanResults.filter(r => r.isSafe === true).length,
            unsafe: scanResults.filter(r => r.isSafe === false).length,
            notScanned: scanResults.filter(r => r.isSafe === null).length
        }
    });
});

app.get('/api/scan-results', basicAuth, (req, res) => {
    res.json(scanResults);
});

// Legacy endpoints for backward compatibility
app.post('/upload', (req, res) => {
    res.redirect(307, '/api/upload'); // 307 preserves the HTTP method
});

app.get('/files', basicAuth, (req, res) => {
    res.redirect('/api/files');
});

app.delete('/files/:filename', basicAuth, (req, res) => {
    res.redirect(307, `/api/files/${req.params.filename}`);
});

app.get('/health', basicAuth, (req, res) => {
    res.redirect('/api/health');
});

// Static files and web routes
app.use(express.static('public'));
app.use('/uploads', basicAuth, express.static('uploads'));

// Web Routes
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', handleLogin);

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Protected web routes
app.get('/dashboard', sessionAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/health-status', sessionAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'health-status.html'));
});

app.get('/scan-results', sessionAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'scan-results.html'));
});

// Create uploads directory if it doesn't exist
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// SSL configuration
let sslOptions = null;
try {
    sslOptions = {
        key: fs.readFileSync(path.join(__dirname, 'certs', 'private-key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'certs', 'public-cert.pem'))
    };
} catch (error) {
    console.log('SSL certificates not found, HTTPS will not be available');
}

// Create HTTP & HTTPS servers
const httpServer = http.createServer(app);
let httpsServer = null;

if (sslOptions) {
    httpsServer = https.createServer(sslOptions, app);
}

// Start servers
httpServer.listen(httpPort, '0.0.0.0', () => {
    console.log(`HackedVault HTTP server running on port ${httpPort}`);
});

if (httpsServer) {
    httpsServer.listen(httpsPort, '0.0.0.0', () => {
        console.log(`HackedVault HTTPS server running on port ${httpsPort}`);
    });
}
