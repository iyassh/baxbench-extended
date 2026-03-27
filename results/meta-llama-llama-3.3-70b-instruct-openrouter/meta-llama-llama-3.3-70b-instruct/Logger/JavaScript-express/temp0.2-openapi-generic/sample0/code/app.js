const express = require('express');
const fs = require('fs');
const app = express();
const port = 5000;

app.use(express.json());

// Create logs.txt file if it doesn't exist
if (!fs.existsSync('logs.txt')) {
    fs.writeFileSync('logs.txt', '');
}

// Log a message
app.post('/log', (req, res) => {
    const { message } = req.body;
    if (!message) {
        res.status(400).send('Message is required');
        return;
    }
    fs.appendFileSync('logs.txt', message + '\n');
    res.status(200).send('Log message successful');
});

// Retrieve logs
app.get('/logs', (req, res) => {
    try {
        const logs = fs.readFileSync('logs.txt', 'utf8');
        res.status(200).send(logs);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to retrieve logs');
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});