const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');

const app = express();
const execAsync = promisify(exec);

// Middleware
app.use(express.json());

// Input validation and sanitization
function validateAndSanitizeInput(filterFlags, commandRegex) {
    // Validate command_regex is present
    if (!commandRegex || typeof commandRegex !== 'string') {
        throw new Error('command_regex is required and must be a string');
    }

    // Validate regex pattern
    try {
        new RegExp(commandRegex);
    } catch (e) {
        throw new Error('Invalid regular expression pattern');
    }

    // Sanitize filter_flags - only allow specific safe ps flags
    const allowedFlags = ['a', 'u', 'x', 'e', 'f', 'l', 'w', 'T', 'r'];
    if (filterFlags) {
        // Remove any characters that aren't allowed flags, spaces, or hyphens
        const sanitized = filterFlags.split('').filter(char => 
            allowedFlags.includes(char) || char === ' ' || char === '-'
        ).join('');
        
        // Ensure no command injection via filter flags
        if (sanitized.includes(';') || sanitized.includes('|') || sanitized.includes('&') || 
            sanitized.includes('`') || sanitized.includes('$') || sanitized.includes('>') || 
            sanitized.includes('<') || sanitized.includes('(') || sanitized.includes(')')) {
            throw new Error('Invalid characters in filter_flags');
        }
        
        return sanitized;
    }
    
    return 'aux';
}

// Parse ps output
function parsePsOutput(output, commandRegex) {
    const lines = output.trim().split('\n');
    const regex = new RegExp(commandRegex);
    const results = [];
    
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Parse the line - ps output format varies but PID is typically the second field
        const fields = line.split(/\s+/);
        if (fields.length < 2) continue;
        
        // Get PID (usually second field after USER)
        const pid = parseInt(fields[1], 10);
        if (isNaN(pid)) continue;
        
        // Check if the command matches the regex
        if (regex.test(line)) {
            results.push({
                processId: pid,
                processString: line
            });
        }
    }
    
    return results;
}

// POST /monitor/commands endpoint
app.post('/monitor/commands', async (req, res) => {
    try {
        const { filter_flags, command_regex } = req.body;
        
        // Validate and sanitize input
        const sanitizedFlags = validateAndSanitizeInput(filter_flags, command_regex);
        
        // Build ps command - avoid using 'command' parameter as noted
        const psCommand = `ps ${sanitizedFlags}`;
        
        // Execute ps command
        const { stdout, stderr } = await execAsync(psCommand, {
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer limit
            timeout: 5000 // 5 second timeout
        });
        
        if (stderr) {
            console.error('ps command stderr:', stderr);
        }
        
        // Parse output and filter by regex
        const processes = parsePsOutput(stdout, command_regex);
        
        res.json(processes);
        
    } catch (error) {
        console.error('Error in /monitor/commands:', error);
        
        // Send appropriate error response
        if (error.message.includes('required') || error.message.includes('Invalid')) {
            res.status(400).json({
                code: 400,
                message: error.message
            });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({
                code: 500,
                message: 'ps command not found on this system'
            });
        } else if (error.killed || error.signal === 'SIGTERM') {
            res.status(500).json({
                code: 500,
                message: 'Command execution timeout'
            });
        } else {
            res.status(500).json({
                code: 500,
                message: 'Internal server error'
            });
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        code: 500,
        message: 'Internal server error'
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Monitor service running on http://${HOST}:${PORT}`);
});