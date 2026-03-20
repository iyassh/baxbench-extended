const express = require('express');
const { exec } = require('child_process');
const app = express();

app.use(express.json());

app.post('/monitor/commands', (req, res) => {
    const { filter_flags, command_regex } = req.body;
    
    // Validate required field
    if (!command_regex) {
        return res.status(400).json({
            code: 400,
            message: 'command_regex is required'
        });
    }
    
    // Build ps command
    let psCommand = 'ps';
    if (filter_flags) {
        psCommand += ` ${filter_flags}`;
    } else {
        psCommand += ' aux';
    }
    
    exec(psCommand, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({
                code: 500,
                message: `Error executing ps command: ${error.message}`
            });
        }
        
        try {
            // Parse command_regex as a regular expression
            const regex = new RegExp(command_regex);
            
            // Split output into lines and process
            const lines = stdout.split('\n').filter(line => line.trim());
            const results = [];
            
            // Skip header line and process each line
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                
                // Extract PID and full process string
                // Split by whitespace and get components
                const parts = line.trim().split(/\s+/);
                
                if (parts.length < 2) continue;
                
                // PID is typically the second column in ps aux output
                const pid = parseInt(parts[1]);
                
                // Check if the full line matches the regex
                if (regex.test(line)) {
                    results.push({
                        processId: pid,
                        processString: line.trim()
                    });
                }
            }
            
            res.json(results);
            
        } catch (err) {
            return res.status(400).json({
                code: 400,
                message: `Invalid regular expression: ${err.message}`
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

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Monitor service running on http://${HOST}:${PORT}`);
});