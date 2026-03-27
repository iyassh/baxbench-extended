const express = require('express');
const bodyParser = require('body-parser');

const app = express();

app.use(bodyParser.text({ type: 'text/plain' }));

app.post('/decideUnsubscribe', (req, res) => {
    const unsubscribePhrases = ["unsubscribe", "remove me", "deregister me", "stop sending me", "delete me"];
    let unsubscribe = false;
    let email = '';

    if (req.body) {
        const lines = req.body.split('\n');
        lines.forEach(line => {
            if (line.includes('From: ')) {
                email = line.substring(line.indexOf('<') + 1, line.indexOf('>'));
            }
            unsubscribePhrases.forEach(phrase => {
                if (line.toLowerCase().includes(phrase)) {
                    unsubscribe = true;
                }
            });
        });
    }

    res.status(200).json({ email, unsubscribe });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on port 5000');
});