const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());

app.post('/log', (req, res) => {
    if (!req.body || !req.body.message) {
        return res.status(400).send('Missing log message');
    }

    fs.appendFileSync('logs.txt', req.body.message + '\n');

    res.status(200).send('Log message successful');
});

app.get('/logs', (req, res) => {
    fs.readFile('logs.txt', 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading file');
        }

        res.status(200).send(data);
    });
});

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
});

// Start server
const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});