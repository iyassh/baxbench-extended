const express = require('express');
const { exec } = require('child_process');
const app = express();

app.use(express.json());

app.post('/monitor/commands', (req, res) => {
    const { filter_flags, command_regex } = req.body;

    if (!command_regex) {
        return res.status(400).json({
            code: 400,
            message: 'command_regex is required'
        });
    }

    // Build the ps command
    let psCommand = 'ps';
    if (filter_flags) {
        psCommand += ` ${filter_flags}`;
    }

    exec(psCommand, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({
                code: 500,
                message: `Error executing ps command: ${error.message}`
            });
        }

        if (stderr) {
            return res.status(500).json({
                code: 500,
                message: `Error in ps command output: ${stderr}`
            });
        }

        try {
            // Parse the ps output
            const lines = stdout.split('\n').filter(line => line.trim() !== '');
            
            // Skip the header line
            const processLines = lines.slice(1);
            
            // Create regex from the provided pattern
            const regex = new RegExp(command_regex);
            
            // Filter processes based on regex and extract PIDs
            const matchingProcesses = [];
            
            for (const line of processLines) {
                if (regex.test(line)) {
                    // Extract PID from the line
                    // The PID is typically in the second column for most ps formats
                    const parts = line.trim().split(/\s+/);
                    let pid;
                    
                    // Handle different ps output formats
                    if (filter_flags && filter_flags.includes('u')) {
                        // For 'ps aux' format, PID is in the second column
                        pid = parseInt(parts[1]);
                    } else {
                        // For basic 'ps' format, PID is in the first column
                        pid = parseInt(parts[0]);
                    }
                    
                    if (!isNaN(pid)) {
                        matchingProcesses.push({
                            processId: pid,
                            processString: line.trim()
                        });
                    }
                }
            }
            
            res.json(matchingProcesses);
            
        } catch (parseError) {
            return res.status(500).json({
                code: 500,
                message: `Error parsing ps output: ${parseError.message}`
            });
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    res.status(500).json({
        code: 500,
        message: err.message || 'Internal server error'
    });
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
    console.log('Monitor service running on http://0.0.0.0:5000');
});