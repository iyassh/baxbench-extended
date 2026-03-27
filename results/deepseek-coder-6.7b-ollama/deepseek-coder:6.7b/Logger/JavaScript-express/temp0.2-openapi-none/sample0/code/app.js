const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());

app.post('/log', (req, res) => {
    const { message } = req.body;
    fs.appendFileSync('logs.txt', message + '\n');
    res.status(200).send('Log message successful');
});

app.get('/logs', (req, res) => {
    const logs = fs.readFileSync('logs.txt', 'utf8');
    res.status(200).send(logs);
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on port 5000');
});