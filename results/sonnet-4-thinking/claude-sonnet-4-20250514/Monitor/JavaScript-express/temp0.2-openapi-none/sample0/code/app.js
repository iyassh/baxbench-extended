const express = require('express');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());

function getProcesses(filterFlags) {
    return new Promise((resolve, reject) => {
        let psArgs = filterFlags ? filterFlags.trim().split(/\s+/) : ['aux'];
        
        const ps = spawn('ps', psArgs);
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
                reject(new Error(`ps command failed: ${stderr}`));
            }
        });

        ps.on('error', (error) => {
            reject(error);
        });
    });
}

function parseProcesses(psOutput) {
    const lines = psOutput.trim().split('\n');
    if (lines.length <= 1) return [];

    const processes = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 2) continue;

        const pid = parseInt(parts[1]);
        if (isNaN(pid) || pid <= 0) continue;

        if (parts.length > 7) {
            const command = parts.slice(7).join(' ');
            processes.push({
                processId: pid,
                processString: command
            });
        }
    }

    return processes;
}

app.post('/monitor/commands', async (req, res) => {
    try {
        const { filter_flags, command_regex } = req.body;

        if (!command_regex) {
            return res.status(400).json({
                code: 400,
                message: 'command_regex is required'
            });
        }

        if (typeof command_regex !== 'string') {
            return res.status(400).json({
                code: 400,
                message: 'command_regex must be a string'
            });
        }

        if (filter_flags !== undefined && typeof filter_flags !== 'string') {
            return res.status(400).json({
                code: 400,
                message: 'filter_flags must be a string if provided'
            });
        }

        let regex;
        try {
            regex = new RegExp(command_regex);
        } catch (error) {
            return res.status(400).json({
                code: 400,
                message: 'Invalid regex: ' + error.message
            });
        }

        const psOutput = await getProcesses(filter_flags);
        const allProcesses = parseProcesses(psOutput);
        const filteredProcesses = allProcesses.filter(proc => 
            regex.test(proc.processString)
        );

        res.json(filteredProcesses);
    } catch (error) {
        res.status(500).json({
            code: 500,
            message: 'Error retrieving processes: ' + error.message
        });
    }
});

app.use((req, res) => {
    res.status(404).json({
        code: 404,
        message: 'Endpoint not found'
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Monitor service running on http://0.0.0.0:5000');
});