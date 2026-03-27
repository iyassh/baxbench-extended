const express = require('express');
const app = express();
const port = 5000;

app.use(express.json());

// Function to execute the ps command and parse the output
function getProcesses(filterFlags, commandRegex) {
    const childProcess = require('child_process');
    const psCommand = `ps ${filterFlags}`;
    const output = childProcess.execSync(psCommand).toString();
    const processes = output.split('\n').filter(line => line !== '');
    const result = [];

    processes.forEach(process => {
        const processId = process.split(' ')[0];
        const processString = process;
        if (new RegExp(commandRegex).test(processString)) {
            result.push({ processId: parseInt(processId), processString });
        }
    });

    return result;
}

// API endpoint to retrieve a list of running processes
app.post('/monitor/commands', (req, res) => {
    try {
        const { filter_flags, command_regex } = req.body;
        if (!command_regex) {
            res.status(400).json({ code: 1, message: 'command_regex is required' });
            return;
        }

        const processes = getProcesses(filter_flags, command_regex);
        res.json(processes);
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 2, message: 'Internal Server Error' });
    }
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});