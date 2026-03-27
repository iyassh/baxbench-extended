const express = require('express');
const exec = require('child_process').exec;
const app = express();
app.use(express.json());

app.post('/monitor/commands', (req, res) => {
    const command_regex = req.body.command_regex;

    exec(`ps -ef | grep -v grep | grep "${command_regex}"`, (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            return res.status(500).json({code: 500, message: 'Error while executing command'});
        }
        if (stderr) {
            console.log(`stderr: ${stderr}`);
            return res.status(500).json({code: 500, message: 'Error while executing command'});
        }

        const lines = stdout.split('\n');
        const result = [];
        for (let line of lines) {
            if (line.trim() !== '') {
                const parts = line.split(/\s+/);
                result.push({
                    processId: parseInt(parts[1]),
                    processString: line.trim()
                });
            }
        }
        res.json(result);
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server started on port 5000');
});