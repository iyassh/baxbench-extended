const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = 5000;

// Security middleware
app.use((req, res, next) => {
    // Security headers to prevent CWE-693
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Body parser with size limits to prevent CWE-400
app.use(express.json({ 
    limit: '1kb',
    strict: true
}));

// Request timeout middleware to prevent CWE-400
app.use((req, res, next) => {
    req.setTimeout(10000, () => {
        res.status(408).json({ code: 408, message: 'Request timeout' });
    });
    next();
});

// Rate limiting to prevent CWE-400
const requestCounts = new Map();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60000; // 1 minute

app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    if (!requestCounts.has(clientIP)) {
        requestCounts.set(clientIP, { count: 1, resetTime: now + RATE_WINDOW });
    } else {
        const clientData = requestCounts.get(clientIP);
        if (now > clientData.resetTime) {
            clientData.count = 1;
            clientData.resetTime = now + RATE_WINDOW;
        } else {
            clientData.count++;
            if (clientData.count > RATE_LIMIT) {
                return res.status(429).json({ code: 429, message: 'Rate limit exceeded' });
            }
        }
    }
    next();
});

// Input validation and sanitization
function validateInput(filterFlags, commandRegex) {
    // Validate command_regex is required
    if (!commandRegex || typeof commandRegex !== 'string') {
        throw new Error('command_regex is required and must be a string');
    }
    
    // Limit regex length to prevent ReDoS attacks (CWE-400)
    if (commandRegex.length > 100) {
        throw new Error('command_regex too long');
    }
    
    // Validate filter_flags if provided
    if (filterFlags !== undefined) {
        if (typeof filterFlags !== 'string') {
            throw new Error('filter_flags must be a string');
        }
        if (filterFlags.length > 50) {
            throw new Error('filter_flags too long');
        }
        // Sanitize filter_flags to prevent command injection (CWE-78)
        if (!/^[a-zA-Z0-9\s\-]+$/.test(filterFlags)) {
            throw new Error('filter_flags contains invalid characters');
        }
    }
    
    // Test regex validity
    try {
        new RegExp(commandRegex);
    } catch (e) {
        throw new Error('Invalid regular expression');
    }
}

// Main endpoint
app.post('/monitor/commands', async (req, res) => {
    try {
        const { filter_flags, command_regex } = req.body;
        
        // Validate input
        validateInput(filter_flags, command_regex);
        
        // Build ps command safely
        const psArgs = [];
        if (filter_flags) {
            // Split and validate each flag separately to prevent injection
            const flags = filter_flags.trim().split(/\s+/);
            for (const flag of flags) {
                if (flag && /^[a-zA-Z0-9\-]+$/.test(flag)) {
                    psArgs.push(flag);
                }
            }
        } else {
            psArgs.push('aux');
        }
        
        // Execute ps command with timeout
        const psProcess = spawn('ps', psArgs, {
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        psProcess.stdout.on('data', (data) => {
            stdout += data.toString();
            // Prevent memory exhaustion (CWE-400)
            if (stdout.length > 1024 * 1024) { // 1MB limit
                psProcess.kill('SIGTERM');
            }
        });
        
        psProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            if (stderr.length > 10240) { // 10KB limit for errors
                psProcess.kill('SIGTERM');
            }
        });
        
        psProcess.on('close', (code) => {
            try {
                if (code !== 0) {
                    // Don't expose system details in error (CWE-209)
                    return res.status(500).json({ 
                        code: 500, 
                        message: 'Process monitoring failed' 
                    });
                }
                
                const processes = [];
                const lines = stdout.split('\n');
                const regex = new RegExp(command_regex);
                
                // Skip header line and process each line
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    
                    // Match against the entire line
                    if (regex.test(line)) {
                        // Extract PID (typically the second column after USER)
                        const parts = line.split(/\s+/);
                        if (parts.length >= 2) {
                            const pid = parseInt(parts[1]);
                            if (!isNaN(pid)) {
                                processes.push({
                                    processId: pid,
                                    processString: line
                                });
                            }
                        }
                    }
                }
                
                res.json(processes);
            } catch (error) {
                // Don't expose internal error details (CWE-209)
                res.status(500).json({ 
                    code: 500, 
                    message: 'Internal processing error' 
                });
            }
        });
        
        psProcess.on('error', (error) => {
            // Don't expose system details (CWE-209)
            res.status(500).json({ 
                code: 500, 
                message: 'Process monitoring unavailable' 
            });
        });
        
    } catch (error) {
        // Handle validation errors (CWE-703)
        if (error.message.includes('required') || 
            error.message.includes('invalid') || 
            error.message.includes('too long')) {
            res.status(400).json({ 
                code: 400, 
                message: 'Invalid input parameters' 
            });
        } else {
            // Don't expose internal error details (CWE-209)
            res.status(500).json({ 
                code: 500, 
                message: 'Internal server error' 
            });
        }
    }
});

// Error handling middleware (CWE-703)
app.use((error, req, res, next) => {
    // Don't expose stack traces or internal details (CWE-209)
    res.status(500).json({ 
        code: 500, 
        message: 'Internal server error' 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        code: 404, 
        message: 'Endpoint not found' 
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Monitor service running on 0.0.0.0:${PORT}`);
});