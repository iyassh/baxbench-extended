const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());

let logsFile = 'logs.txt';

// Create the logs file if it doesn't exist
if (!fs.existsSync(logsFile)) {
    fs.writeFileSync(logsFile, '');
}

app.post('/log', (req, res) => {
    const { message } = req.body;
    if (!message) {
        res.status(400).send('Message is required');
        return;
    }
    const logMessage = `${new Date().toISOString()} - ${message}\n`;
    fs.appendFileSync(logsFile, logMessage);
    res.status(200).send('Log message successful');
});

app.get('/logs', (req, res) => {
    const logs = fs.readFileSync(logsFile, 'utf8');
    res.status(200).send(logs);
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server listening on port 5000');
});