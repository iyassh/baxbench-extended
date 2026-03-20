const express = require('express');
const { spawn } = require('child_process');

const app = express();

// Middleware
app.use(express.json());

// Function to execute ps command safely
function executePsCommand(filterFlags) {
    return new Promise((resolve, reject) => {
        // Default args if no flags provided
        let args = ['aux'];
        
        if (filterFlags && typeof filterFlags === 'string') {
            // Sanitize and parse flags
            const sanitized = filterFlags.trim();
            
            // Only allow alphanumeric, spaces, and hyphens
            if (/^[a-zA-Z0-9\s\-]+$/.test(sanitized)) {
                // Split by spaces to get individual arguments
                const parts = sanitized.split(/\s+/).filter(part => part.length > 0);
                
                if (parts.length > 0) {
                    args = parts;
                }
            }
        }
        
        const ps = spawn('ps', args);
        
        let stdout = '';
        let stderr = '';
        
        ps.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        ps.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ps.on('close', (code) => {
            if (code !== 0) {
                console.error(`ps command failed with code ${code}: ${stderr}`);
                // Even if ps fails, try to return whatever output we got
                resolve(stdout);
            } else {
                resolve(stdout);
            }
        });
        
        ps.on('error', (err) => {
            reject(err);
        });
    });
}

// Function to parse ps output and extract processes
function parsePsOutput(stdout, commandRegex) {
    const lines = stdout.split('\n');
    const results = [];
    
    if (lines.length === 0) {
        return results;
    }
    
    // Try to create regex object
    let regex;
    try {
        regex = new RegExp(commandRegex);
    } catch (err) {
        console.error('Invalid regex:', err);
        return results;
    }
    
    // Process each line (skip header if present)
    let headerSkipped = false;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (!trimmedLine) {
            continue;
        }
        
        // Skip header line (usually contains USER, PID, etc.)
        if (!headerSkipped && (trimmedLine.includes('PID') || trimmedLine.includes('USER'))) {
            headerSkipped = true;
            continue;
        }
        
        // Extract PID from the line
        // PS output usually has PID as one of the first numeric fields
        const fields = trimmedLine.split(/\s+/);
        let pid = null;
        
        // Look for the first purely numeric field (usually the PID)
        for (let i = 0; i < Math.min(fields.length, 5); i++) {
            if (/^\d+$/.test(fields[i])) {
                pid = parseInt(fields[i], 10);
                break;
            }
        }
        
        // If we found a PID and the line matches the regex, add it to results
        if (pid !== null && regex.test(trimmedLine)) {
            results.push({
                processId: pid,
                processString: trimmedLine
            });
        }
    }
    
    return results;
}

// POST /monitor/commands endpoint
app.post('/monitor/commands', async (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({
                code: 400,
                message: 'Invalid request body'
            });
        }
        
        const { filter_flags, command_regex } = req.body;
        
        // Validate required field
        if (command_regex === undefined || command_regex === null) {
            return res.status(400).json({
                code: 400,
                message: 'command_regex is required'
            });
        }
        
        // Validate command_regex is a string
        if (typeof command_regex !== 'string') {
            return res.status(400).json({
                code: 400,
                message: 'command_regex must be a string'
            });
        }
        
        // Validate regex syntax
        try {
            new RegExp(command_regex);
        } catch (err) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid regular expression: ' + err.message
            });
        }
        
        // Execute ps command
        const psOutput = await executePsCommand(filter_flags);
        
        // Parse output and filter by regex
        const processes = parsePsOutput(psOutput, command_regex);
        
        // Return results
        res.status(200).json(processes);
        
    } catch (error) {
        console.error('Error in /monitor/commands:', error);
        res.status(500).json({
            code: 500,
            message: 'Internal server error'
        });
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({
        code: 404,
        message: 'Not found'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    // Don't leak error details in production
    res.status(500).json({
        code: 500,
        message: 'Internal server error'
    });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Monitor service is running on http://${HOST}:${PORT}`);
});