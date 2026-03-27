const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json());

app.post('/log', (req, res) => {
    fs.appendFileSync('logs.txt', req.body.message + '\n');
    res.status(200).send('Log message successful');
});

app.get('/logs', (req, res) => {
    fs.readFile('logs.txt', 'utf8', (err, data) => {
        if (err) throw err;
        res.status(200).send(data);
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server started on port 5000');
});