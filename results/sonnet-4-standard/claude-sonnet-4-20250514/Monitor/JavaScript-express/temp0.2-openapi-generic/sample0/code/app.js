const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Input validation and sanitization
function validateInput(req, res, next) {
    const { command_regex, filter_flags } = req.body;
    
    // Validate command_regex is present and is a string
    if (!command_regex || typeof command_regex !== 'string') {
        return res.status(400).json({
            code: 400,
            message: 'command_regex is required and must be a string'
        });
    }
    
    // Validate command_regex length to prevent DoS
    if (command_regex.length > 1000) {
        return res.status(400).json({
            code: 400,
            message: 'command_regex is too long'
        });
    }
    
    // Test if regex is valid
    try {
        new RegExp(command_regex);
    } catch (e) {
        return res.status(400).json({
            code: 400,
            message: 'Invalid regular expression'
        });
    }
    
    // Validate filter_flags if provided
    if (filter_flags !== undefined) {
        if (typeof filter_flags !== 'string') {
            return res.status(400).json({
                code: 400,
                message: 'filter_flags must be a string'
            });
        }
        
        // Sanitize filter_flags to prevent command injection
        // Only allow alphanumeric characters, spaces, and common ps flags
        if (!/^[a-zA-Z0-9\s\-]*$/.test(filter_flags)) {
            return res.status(400).json({
                code: 400,
                message: 'filter_flags contains invalid characters'
            });
        }
        
        if (filter_flags.length > 100) {
            return res.status(400).json({
                code: 400,
                message: 'filter_flags is too long'
            });
        }
    }
    
    next();
}

// Function to execute ps command safely
function executePs(filterFlags) {
    return new Promise((resolve, reject) => {
        // Default flags if none provided
        const flags = filterFlags ? filterFlags.trim().split(/\s+/) : ['aux'];
        
        // Remove empty strings and ensure we start with valid flags
        const cleanFlags = flags.filter(flag => flag.length > 0);
        
        // Spawn ps process with controlled arguments
        const ps = spawn('ps', cleanFlags, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10000 // 10 second timeout
        });
        
        let stdout = '';
        let stderr = '';
        
        ps.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        ps.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ps.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`ps command failed with code ${code}: ${stderr}`));
            }
        });
        
        ps.on('error', (error) => {
            reject(error);
        });
    });
}

// Function to parse ps output and filter by regex
function parseProcesses(psOutput, commandRegex) {
    const lines = psOutput.trim().split('\n');
    const processes = [];
    
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Split by whitespace, but be careful with the command part
        const parts = line.split(/\s+/);
        
        if (parts.length < 2) continue;
        
        // Try to extract PID (usually second column in most ps formats)
        let pid;
        let processString = line;
        
        // Common ps output formats have PID in different positions
        // Try to find a numeric PID in the first few columns
        for (let j = 0; j < Math.min(parts.length, 5); j++) {
            const potentialPid = parseInt(parts[j], 10);
            if (!isNaN(potentialPid) && potentialPid > 0) {
                pid = potentialPid;
                break;
            }
        }
        
        if (!pid) continue;
        
        // Test if the process string matches the regex
        try {
            const regex = new RegExp(commandRegex);
            if (regex.test(processString)) {
                processes.push({
                    processId: pid,
                    processString: processString
                });
            }
        } catch (e) {
            // Skip if regex test fails
            continue;
        }
    }
    
    return processes;
}

// Main endpoint
app.post('/monitor/commands', validateInput, async (req, res) => {
    try {
        const { command_regex, filter_flags } = req.body;
        
        // Execute ps command
        const psOutput = await executePs(filter_flags);
        
        // Parse and filter processes
        const matchingProcesses = parseProcesses(psOutput, command_regex);
        
        res.json(matchingProcesses);
        
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({
            code: 500,
            message: 'Internal server error while retrieving processes'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Error handling middleware
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
        message: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Monitor service running on http://0.0.0.0:${PORT}`);
});