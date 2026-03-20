const express = require('express');
const { spawn } = require('child_process');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Parse JSON bodies with size limit
app.use(express.json({ limit: '10kb' }));

// Simple rate limiting with cleanup
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 20;

// Cleanup old entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of requestCounts.entries()) {
        if (now - data.windowStart > RATE_LIMIT_WINDOW * 2) {
            requestCounts.delete(ip);
        }
    }
}, RATE_LIMIT_WINDOW);

function rateLimit(req, res, next) {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    const clientData = requestCounts.get(clientIp) || { count: 0, windowStart: now };
    
    if (now - clientData.windowStart > RATE_LIMIT_WINDOW) {
        clientData.count = 1;
        clientData.windowStart = now;
    } else {
        clientData.count++;
    }
    
    requestCounts.set(clientIp, clientData);
    
    if (clientData.count > RATE_LIMIT_MAX) {
        return res.status(429).json({
            code: 429,
            message: 'Too many requests'
        });
    }
    
    next();
}

app.use(rateLimit);

// Validate ps filter flags using whitelist approach
function validateFilterFlags(flags) {
    if (!flags) return ['aux'];
    
    if (typeof flags !== 'string') {
        throw new Error('Filter flags must be a string');
    }
    
    // Strict whitelist for security
    const allowedFlagSets = {
        'aux': ['aux'],
        'axf': ['axf'], 
        'ef': ['ef'],
        'ux': ['ux'],
        'aux -T': ['aux', '-T'],
        'a': ['a'],
        'u': ['u'],
        'x': ['x'],
        'f': ['f'],
        'e': ['e']
    };
    
    const normalized = flags.trim();
    if (allowedFlagSets[normalized]) {
        return allowedFlagSets[normalized];
    }
    
    throw new Error('Unsupported filter flags');
}

// Execute ps command safely
function executePs(flags) {
    return new Promise((resolve, reject) => {
        let resolved = false;
        
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error('Command execution timeout'));
            }
        }, 10000);
        
        const ps = spawn('ps', flags, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false // Critical for security
        });
        
        let stdout = '';
        let stderr = '';
        
        ps.stdout.on('data', (data) => {
            stdout += data.toString();
            // Prevent memory exhaustion
            if (stdout.length > 2 * 1024 * 1024) { // 2MB limit
                ps.kill('SIGTERM');
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('Command output too large'));
                }
            }
        });
        
        ps.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ps.on('error', (error) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                reject(new Error('Failed to execute ps command'));
            }
        });
        
        ps.on('close', (code) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error('ps command failed'));
                }
            }
        });
    });
}

// Parse ps output to extract process information
function parseProcessOutput(output) {
    const lines = output.split('\n');
    const processes = [];
    
    // Skip header line (first line) and process remaining lines
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Extract PID - typically the second column
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
            const pid = parseInt(parts[1], 10);
            if (!isNaN(pid) && pid > 0) {
                processes.push({
                    processId: pid,
                    processString: line
                });
            }
        }
    }
    
    return processes;
}

// Filter processes using regex with security measures
function filterProcesses(processes, regexPattern) {
    // Length validation
    if (regexPattern.length > 500) {
        throw new Error('Regex pattern too long');
    }
    
    // Detect dangerous regex patterns that could cause ReDoS
    const dangerousPatterns = [
        /(\*.*\+)|(\+.*\*)/,  // nested quantifiers
        /\(\?\=/,             // positive lookaheads
        /\(\?\!/,             // negative lookaheads  
        /\(\?\<[!=]/,         // lookbehinds
        /\(\?[^:)]/           // other advanced features
    ];
    
    for (const dangerous of dangerousPatterns) {
        if (dangerous.test(regexPattern)) {
            throw new Error('Unsafe regex pattern detected');
        }
    }
    
    let regex;
    try {
        regex = new RegExp(regexPattern, 'i');
    } catch (error) {
        throw new Error('Invalid regex pattern');
    }
    
    const filtered = [];
    const maxRegexTime = 50; // milliseconds
    
    for (const process of processes) {
        try {
            const startTime = Date.now();
            if (regex.test(process.processString)) {
                filtered.push(process);
            }
            // Check for ReDoS
            if (Date.now() - startTime > maxRegexTime) {
                throw new Error('Regex execution took too long');
            }
        } catch (error) {
            if (error.message.includes('took too long')) {
                throw error;
            }
            // Skip this process if regex test fails for other reasons
        }
    }
    
    return filtered;
}

// Main API endpoint
app.post('/monitor/commands', async (req, res) => {
    try {
        // Validate request body structure
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({
                code: 400,
                message: 'Invalid request body'
            });
        }
        
        const { filter_flags, command_regex } = req.body;
        
        // Validate command_regex (required field)
        if (!command_regex || typeof command_regex !== 'string') {
            return res.status(400).json({
                code: 400,
                message: 'command_regex is required and must be a string'
            });
        }
        
        if (command_regex.trim() === '') {
            return res.status(400).json({
                code: 400,
                message: 'command_regex cannot be empty'
            });
        }
        
        // Validate filter_flags (optional field)
        let psFlags;
        try {
            psFlags = validateFilterFlags(filter_flags);
        } catch (error) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid filter_flags'
            });
        }
        
        // Execute ps command
        const psOutput = await executePs(psFlags);
        
        // Parse process output
        const allProcesses = parseProcessOutput(psOutput);
        
        // Filter processes by regex
        const matchingProcesses = filterProcesses(allProcesses, command_regex);
        
        // Return results according to OpenAPI spec
        res.json(matchingProcesses);
        
    } catch (error) {
        console.error('Request processing error:', error.message);
        
        // Return generic error to prevent information disclosure
        res.status(500).json({
            code: 500,
            message: 'Internal server error'
        });
    }
});

// Global error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        code: 500,
        message: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        code: 404,
        message: 'Not found'
    });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});