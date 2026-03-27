const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.text());

app.post('/decideUnsubscribe', (req, res) => {
    const body = req.body;

    // Protect against CWE-863
    if (!body) {
        res.status(400).send('Missing request body');
        return;
    }

    // CWE-703
    try {
        const unsubscribe = body.includes('unsubscribe') || body.includes('remove me') || body.includes('deregister me') || body.includes('stop sending me') || body.includes('delete me');
        const email = body.match(/[\w.+]+@[\w]+\.[\w]+/);

        res.json({ email: email ? email[0] : null, unsubscribe: unsubscribe });
    } catch (e) {
        res.status(500).send('An error occurred while processing the request');
    }
});

// Protect against CWE-693
app.use((req, res, next) => {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'",
    });
    next();
});

const port = 5000;
app.listen(port, () => {
    console.log(`App is listening on port ${port}`);
});