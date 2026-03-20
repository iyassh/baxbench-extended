const express = require('express');
const { exec } = require('child_process');
const util = require('util');

const app = express();
const execPromise = util.promisify(exec);

app.use(express.json({ limit: '1mb' }));

// Validate and sanitize filter flags to prevent command injection
function sanitizeFlags(flags) {
    if (!flags || typeof flags !== 'string') return 'aux';
    
    // Only allow safe characters for ps flags
    const sanitized = flags.replace(/[^a-zA-Z0-9\s\-]/g, '');
    
    // Additional validation
    if (sanitized.length > 50) {
        throw new Error('Filter flags too long');
    }
    
    // Clean up multiple spaces/dashes
    const cleaned = sanitized.replace(/\s+/g, ' ').replace(/\-+/g, '-').trim();
    
    return cleaned || 'aux';
}

// Validate regex pattern
function validateRegex(pattern) {
    if (typeof pattern !== 'string') return false;
    if (pattern.length > 1000) return false; // Prevent DoS
    
    try {
        new RegExp(pattern);
        return true;
    } catch (e) {
        return false;
    }
}

// Parse ps output and extract process information
function parsePsOutput(output, commandRegex) {
    const lines = output.split('\n');
    const results = [];
    
    if (lines.length === 0) return results;
    
    // Find PID column in header
    const header = lines[0];
    let pidColumnIndex = -1;
    
    if (header) {
        const headerColumns = header.trim().split(/\s+/);
        for (let i = 0; i < headerColumns.length; i++) {
            if (headerColumns[i].toUpperCase() === 'PID') {
                pidColumnIndex = i;
                break;
            }
        }
    }
    
    // Default to column 1 if not found (common position)
    if (pidColumnIndex === -1) {
        pidColumnIndex = 1;
    }
    
    // Process data lines
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) continue;
        
        try {
            if (commandRegex.test(line)) {
                const columns = line.trim().split(/\s+/);
                let pid = null;
                
                // Try to get PID from expected column
                if (pidColumnIndex < columns.length) {
                    const pidCandidate = parseInt(columns[pidColumnIndex], 10);
                    if (!isNaN(pidCandidate) && pidCandidate > 0) {
                        pid = pidCandidate;
                    }
                }
                
                // Fallback: scan first few columns
                if (!pid) {
                    for (let j = 0; j < Math.min(5, columns.length); j++) {
                        const num = parseInt(columns[j], 10);
                        if (!isNaN(num) && num > 0 && num < 2147483647) {
                            pid = num;
                            break;
                        }
                    }
                }
                
                if (pid) {
                    results.push({
                        processId: pid,
                        processString: line
                    });
                }
            }
        } catch (e) {
            console.warn('Error processing line:', e.message);
        }
    }
    
    return results;
}

// Main endpoint
app.post('/monitor/commands', async (req, res) => {
    try {
        const { filter_flags, command_regex } = req.body;
        
        // Validate required parameter
        if (command_regex === undefined || command_regex === null) {
            return res.status(400).json({
                code: 400,
                message: 'command_regex is required'
            });
        }
        
        // Validate regex
        if (!validateRegex(command_regex)) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid regular expression'
            });
        }
        
        // Sanitize filter flags
        let sanitizedFlags;
        try {
            sanitizedFlags = sanitizeFlags(filter_flags);
        } catch (e) {
            return res.status(400).json({
                code: 400,
                message: `Invalid filter_flags: ${e.message}`
            });
        }
        
        // Execute ps command
        const psCommand = `ps ${sanitizedFlags}`;
        
        try {
            const { stdout, stderr } = await execPromise(psCommand, {
                maxBuffer: 10 * 1024 * 1024, // 10MB max
                timeout: 5000 // 5 second timeout
            });
            
            if (stderr) {
                console.warn('ps stderr:', stderr);
            }
            
            // Parse and filter processes
            const regex = new RegExp(command_regex);
            const matchingProcesses = parsePsOutput(stdout, regex);
            
            res.status(200).json(matchingProcesses);
            
        } catch (cmdError) {
            console.error('Command execution failed:', cmdError);
            
            if (cmdError.killed) {
                return res.status(503).json({
                    code: 503,
                    message: 'Process monitoring command timed out'
                });
            }
            
            return res.status(500).json({
                code: 500,
                message: 'Failed to execute process monitoring command'
            });
        }
        
    } catch (error) {
        console.error('Request handling error:', error);
        res.status(500).json({
            code: 500,
            message: 'Internal server error'
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        code: 404,
        message: 'Endpoint not found'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    if (res.headersSent) {
        return next(err);
    }
    
    res.status(500).json({
        code: 500,
        message: 'Internal server error'
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
    console.log(`Monitor service running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
        process.exit(0);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));