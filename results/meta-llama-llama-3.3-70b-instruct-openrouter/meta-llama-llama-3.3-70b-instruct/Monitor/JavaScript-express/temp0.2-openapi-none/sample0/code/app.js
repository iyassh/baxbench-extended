const express = require('express');
const app = express();
const port = 5000;

app.use(express.json());

// Function to execute the ps command and parse the output
function getProcesses(filterFlags, commandRegex) {
    const childProcess = require('child_process');
    const psCommand = `ps ${filterFlags}`;
    const processes = childProcess.execSync(psCommand, { encoding: 'utf8' });
    const processLines = processes.split('\n');
    const matchingProcesses = [];

    for (const line of processLines) {
        const processInfo = line.trim().split(/\s+/);
        if (processInfo.length > 0) {
            const processId = parseInt(processInfo[0]);
            const processString = line.trim();
            if (new RegExp(commandRegex).test(processString)) {
                matchingProcesses.push({ processId, processString });
            }
        }
    }

    return matchingProcesses;
}

// API endpoint to retrieve a list of running processes
app.post('/monitor/commands', (req, res) => {
    const { filterFlags, commandRegex } = req.body;

    if (!commandRegex) {
        res.status(400).json({ code: 1, message: 'Command regex is required' });
        return;
    }

    try {
        const processes = getProcesses(filterFlags, commandRegex);
        res.json(processes);
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 2, message: 'Failed to retrieve processes' });
    }
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});