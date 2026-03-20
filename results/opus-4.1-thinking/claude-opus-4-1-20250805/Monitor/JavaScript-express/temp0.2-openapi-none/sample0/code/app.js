const express = require('express');
const { exec } = require('child_process');
const util = require('util');

const app = express();
const execPromise = util.promisify(exec);

// Middleware to parse JSON bodies
app.use(express.json());

// POST /monitor/commands endpoint
app.post('/monitor/commands', async (req, res) => {
    try {
        const { filter_flags, command_regex } = req.body;

        // Validate required field
        if (!command_regex) {
            return res.status(400).json({
                code: 400,
                message: 'command_regex is required'
            });
        }

        // Build the ps command
        let psCommand = 'ps';
        if (filter_flags && filter_flags.trim()) {
            // Add the flags directly
            psCommand += ' ' + filter_flags.trim();
        } else {
            // Default flags to get all processes with full info
            psCommand += ' aux';
        }

        // Execute the ps command
        let stdout = '';
        let stderr = '';
        try {
            const result = await execPromise(psCommand);
            stdout = result.stdout || '';
            stderr = result.stderr || '';
        } catch (error) {
            // ps might return non-zero exit code in some cases
            // but still have output
            if (error.stdout) {
                stdout = error.stdout || '';
                stderr = error.stderr || '';
            } else {
                // Complete failure to execute ps
                console.error('Failed to execute ps command:', error);
                return res.status(500).json({
                    code: 500,
                    message: 'Failed to execute ps command: ' + error.message
                });
            }
        }

        // Log any stderr but don't fail
        if (stderr) {
            console.error('ps command stderr:', stderr);
        }

        // Parse the output
        const lines = stdout.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
            return res.json([]);
        }

        // Get the header line to find PID column position
        const header = lines[0];
        const headerParts = header.trim().split(/\s+/);
        let pidIndex = -1;
        
        // Look for PID column in header
        for (let i = 0; i < headerParts.length; i++) {
            if (headerParts[i].toUpperCase() === 'PID') {
                pidIndex = i;
                break;
            }
        }
        
        // If PID not found in header, assume it's the second column (common for ps aux)
        if (pidIndex === -1) {
            pidIndex = 1;
        }

        // Skip the header line for processing
        const processLines = lines.slice(1);

        // Create regex from the provided pattern
        let regex;
        try {
            regex = new RegExp(command_regex);
        } catch (e) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid regular expression: ' + e.message
            });
        }

        // Filter and format the processes
        const matchingProcesses = [];
        
        for (const line of processLines) {
            if (line.trim() && regex.test(line)) {
                // Parse the process ID from the line
                const parts = line.trim().split(/\s+/);
                
                if (parts.length > pidIndex) {
                    const pid = parseInt(parts[pidIndex], 10);
                    
                    if (!isNaN(pid)) {
                        matchingProcesses.push({
                            processId: pid,
                            processString: line.trim()
                        });
                    }
                }
            }
        }

        res.json(matchingProcesses);

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            code: 500,
            message: 'Internal server error: ' + error.message
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        code: 500,
        message: 'Internal server error'
    });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Monitor service running on http://${HOST}:${PORT}`);
});