const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const app = express();
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Request size limit to prevent resource exhaustion
app.use(express.json({ limit: '1mb' }));

// Timeout middleware to prevent resource exhaustion
app.use((req, res, next) => {
    req.setTimeout(30000); // 30 second timeout
    res.setTimeout(30000);
    next();
});

// Validate and sanitize ps flags
function validatePsFlags(flags) {
    if (!flags) return '';
    
    // Whitelist allowed ps flags
    const allowedFlags = ['a', 'u', 'x', 'e', 'f', 'l', 'w', 'T', 'H', 'r', 'n'];
    const flagPattern = new RegExp(`^[${allowedFlags.join('')}\\s-]+$`);
    
    if (!flagPattern.test(flags)) {
        throw new Error('Invalid ps flags');
    }
    
    // Remove any potential command injection attempts
    return flags.replace(/[;&|`$()<>]/g, '');
}

// Validate regex pattern
function validateRegex(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        throw new Error('Invalid regex pattern');
    }
    
    // Limit regex length to prevent ReDoS
    if (pattern.length > 1000) {
        throw new Error('Regex pattern too long');
    }
    
    try {
        new RegExp(pattern);
        return pattern;
    } catch (e) {
        throw new Error('Invalid regex pattern');
    }
}

app.post('/monitor/commands', async (req, res) => {
    try {
        const { filter_flags, command_regex } = req.body;
        
        // Validate required fields
        if (!command_regex) {
            return res.status(400).json({
                code: 400,
                message: 'Missing required field: command_regex'
            });
        }
        
        // Validate inputs
        let sanitizedFlags = '';
        try {
            sanitizedFlags = validatePsFlags(filter_flags);
        } catch (e) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid filter flags'
            });
        }
        
        let regex;
        try {
            const validatedPattern = validateRegex(command_regex);
            regex = new RegExp(validatedPattern);
        } catch (e) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid regex pattern'
            });
        }
        
        // Build ps command safely
        const psCommand = sanitizedFlags ? `ps ${sanitizedFlags}` : 'ps';
        
        // Execute ps command with timeout
        let stdout;
        try {
            const result = await execAsync(psCommand, {
                timeout: 10000, // 10 second timeout
                maxBuffer: 1024 * 1024 * 10 // 10MB max buffer
            });
            stdout = result.stdout;
        } catch (error) {
            console.error('Process execution error');
            return res.status(500).json({
                code: 500,
                message: 'Failed to retrieve process list'
            });
        }
        
        // Parse ps output
        const lines = stdout.split('\n').filter(line => line.trim());
        const processes = [];
        
        // Skip header line
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            
            // Test if the line matches the regex
            if (regex.test(line)) {
                // Extract PID (first numeric field)
                const fields = line.trim().split(/\s+/);
                let pid = null;
                
                for (const field of fields) {
                    if (/^\d+$/.test(field)) {
                        pid = parseInt(field, 10);
                        break;
                    }
                }
                
                if (pid !== null) {
                    processes.push({
                        processId: pid,
                        processString: line.trim()
                    });
                }
            }
        }
        
        res.json(processes);
        
    } catch (error) {
        console.error('Unexpected error in monitor endpoint');
        res.status(500).json({
            code: 500,
            message: 'Internal server error'
        });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({
        code: 500,
        message: 'Internal server error'
    });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        code: 404,
        message: 'Not found'
    });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    server.close(() => {
        console.log('Server closed');
    });
});

process.on('SIGINT', () => {
    server.close(() => {
        console.log('Server closed');
    });
});