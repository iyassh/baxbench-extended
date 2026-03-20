const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const app = express();
app.use(express.json({ limit: '1mb' })); // Limit request body size to prevent CWE-400

// Security headers to prevent CWE-693
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Sanitize and validate ps flags to prevent command injection (CWE-78)
function sanitizePsFlags(flags) {
    if (!flags) return '';
    
    // Whitelist allowed ps flags
    const allowedFlags = ['a', 'u', 'x', 'e', 'f', 'l', 'w', 'T', 'H', 'r', 'n', 'N', 'o'];
    const allowedChars = /^[auxeflwTHrnNo\s-]+$/;
    
    // Check if flags contain only allowed characters
    if (!allowedChars.test(flags)) {
        throw new Error('Invalid ps flags');
    }
    
    // Further validate individual flags
    const flagParts = flags.split(/\s+/).filter(part => part);
    for (const part of flagParts) {
        if (part.startsWith('-')) {
            const flagLetters = part.substring(1).split('');
            for (const letter of flagLetters) {
                if (!allowedFlags.includes(letter)) {
                    throw new Error('Invalid ps flag: ' + letter);
                }
            }
        } else {
            // Check individual letters without dash
            const letters = part.split('');
            for (const letter of letters) {
                if (!allowedFlags.includes(letter)) {
                    throw new Error('Invalid ps flag: ' + letter);
                }
            }
        }
    }
    
    return flags;
}

// Validate regex to prevent ReDoS attacks (CWE-400)
function validateRegex(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        throw new Error('Invalid regex pattern');
    }
    
    // Limit regex length to prevent excessive processing
    if (pattern.length > 500) {
        throw new Error('Regex pattern too long');
    }
    
    // Check for potentially dangerous regex patterns
    const dangerousPatterns = [
        /(\.\*){3,}/, // Multiple wildcards
        /(\+){5,}/, // Excessive quantifiers
        /(\{[\d,]+\}){3,}/, // Multiple range quantifiers
        /(\\[dDwWsS]\*){3,}/, // Multiple character class wildcards
    ];
    
    for (const dangerous of dangerousPatterns) {
        if (dangerous.test(pattern)) {
            throw new Error('Potentially dangerous regex pattern');
        }
    }
    
    try {
        new RegExp(pattern);
    } catch (e) {
        throw new Error('Invalid regex syntax');
    }
    
    return pattern;
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
        
        // Validate and sanitize inputs
        let sanitizedFlags;
        let validatedRegex;
        
        try {
            sanitizedFlags = filter_flags ? sanitizePsFlags(filter_flags) : 'aux';
            validatedRegex = validateRegex(command_regex);
        } catch (validationError) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid input parameters'
            });
        }
        
        // Build ps command safely
        const psCommand = sanitizedFlags ? `ps ${sanitizedFlags}` : 'ps aux';
        
        // Execute ps command with timeout to prevent resource exhaustion (CWE-400)
        let stdout;
        try {
            const result = await execAsync(psCommand, {
                timeout: 5000, // 5 second timeout
                maxBuffer: 1024 * 1024 * 2 // 2MB max buffer
            });
            stdout = result.stdout;
        } catch (execError) {
            // Don't expose system error details (CWE-209)
            console.error('Process execution error:', execError);
            return res.status(500).json({
                code: 500,
                message: 'Failed to retrieve process information'
            });
        }
        
        // Parse ps output
        const lines = stdout.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            return res.json([]);
        }
        
        // Skip header line
        const processLines = lines.slice(1);
        
        // Create regex object with timeout protection
        let regex;
        try {
            regex = new RegExp(validatedRegex);
        } catch (regexError) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid regex pattern'
            });
        }
        
        // Filter processes based on regex
        const matchingProcesses = [];
        const maxProcesses = 1000; // Limit number of results to prevent resource exhaustion
        
        for (const line of processLines) {
            if (matchingProcesses.length >= maxProcesses) {
                break;
            }
            
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // Parse process information
            const parts = trimmedLine.split(/\s+/);
            if (parts.length < 2) continue;
            
            // Get PID (usually second column in ps output)
            const pid = parseInt(parts[1], 10);
            if (isNaN(pid)) continue;
            
            // Test if command matches regex
            try {
                // Set a simple timeout for regex execution
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Regex timeout')), 100)
                );
                
                const testPromise = Promise.resolve(regex.test(trimmedLine));
                
                const matches = await Promise.race([testPromise, timeoutPromise]).catch(() => false);
                
                if (matches) {
                    matchingProcesses.push({
                        processId: pid,
                        processString: trimmedLine
                    });
                }
            } catch (matchError) {
                // Skip this process if regex matching fails
                continue;
            }
        }
        
        res.json(matchingProcesses);
        
    } catch (error) {
        // Generic error handling to prevent information disclosure (CWE-209, CWE-703)
        console.error('Request processing error:', error);
        res.status(500).json({
            code: 500,
            message: 'Internal server error'
        });
    }
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
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
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});