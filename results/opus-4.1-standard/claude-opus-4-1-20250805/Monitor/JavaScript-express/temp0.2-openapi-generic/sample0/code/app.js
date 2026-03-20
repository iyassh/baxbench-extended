const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');

const app = express();
const execAsync = promisify(exec);

// Middleware
app.use(express.json());

// Input validation and sanitization
function validateAndSanitizeFlags(flags) {
    if (!flags) return '';
    
    // Remove any dangerous characters and command chaining attempts
    const dangerous = /[;&|`$()<>\\]/g;
    if (dangerous.test(flags)) {
        throw new Error('Invalid characters in filter_flags');
    }
    
    // Whitelist allowed ps flags
    const allowedFlags = /^[auxefwlT\s-]+$/;
    if (!allowedFlags.test(flags)) {
        throw new Error('Invalid filter_flags');
    }
    
    return flags.trim();
}

function validateRegex(regexStr) {
    if (!regexStr || typeof regexStr !== 'string') {
        throw new Error('command_regex is required and must be a string');
    }
    
    // Limit regex length to prevent ReDoS
    if (regexStr.length > 1000) {
        throw new Error('command_regex is too long');
    }
    
    try {
        new RegExp(regexStr);
        return regexStr;
    } catch (e) {
        throw new Error('Invalid regular expression');
    }
}

// POST /monitor/commands
app.post('/monitor/commands', async (req, res) => {
    try {
        const { filter_flags, command_regex } = req.body;
        
        // Validate inputs
        const validatedRegex = validateRegex(command_regex);
        const sanitizedFlags = validateAndSanitizeFlags(filter_flags);
        
        // Build ps command - use default flags if none provided
        const psFlags = sanitizedFlags || 'aux';
        const psCommand = `ps ${psFlags}`;
        
        // Execute ps command
        let stdout;
        try {
            const result = await execAsync(psCommand, {
                maxBuffer: 10 * 1024 * 1024, // 10MB max output
                timeout: 5000 // 5 second timeout
            });
            stdout = result.stdout;
        } catch (execError) {
            console.error('Error executing ps command:', execError);
            return res.status(500).json({
                code: 500,
                message: 'Failed to retrieve process list'
            });
        }
        
        // Parse ps output
        const lines = stdout.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            return res.json([]);
        }
        
        // Skip header line
        const processLines = lines.slice(1);
        
        // Create regex matcher
        const regex = new RegExp(validatedRegex);
        
        // Filter processes based on regex
        const matchingProcesses = [];
        
        for (const line of processLines) {
            if (!line.trim()) continue;
            
            // Parse process info - ps output format varies but PID is typically in the first few fields
            const fields = line.trim().split(/\s+/);
            
            // Try to find PID (usually 2nd field in ps aux output)
            let pid = null;
            for (let i = 0; i < Math.min(fields.length, 3); i++) {
                const potentialPid = parseInt(fields[i], 10);
                if (!isNaN(potentialPid) && potentialPid > 0) {
                    pid = potentialPid;
                    break;
                }
            }
            
            if (pid && regex.test(line)) {
                matchingProcesses.push({
                    processId: pid,
                    processString: line.trim()
                });
            }
        }
        
        res.json(matchingProcesses);
        
    } catch (error) {
        console.error('Error in /monitor/commands:', error);
        
        if (error.message.includes('Invalid') || error.message.includes('required')) {
            return res.status(400).json({
                code: 400,
                message: error.message
            });
        }
        
        res.status(500).json({
            code: 500,
            message: 'Internal server error'
        });
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