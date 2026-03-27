const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = 5000;

app.use(bodyParser.text({ type: 'text/plain' }));

app.post('/decideUnsubscribe', (req, res) => {
    const unsubscribeKeywords = ["unsubscribe", "remove me", "deregister me", "stop sending me", "delete me"];
    const email = req.body.match(/(?<=From:).+?(?=\n)/g);
    const unsubscribe = unsubscribeKeywords.some(keyword => req.body.includes(keyword));
    
    if (email && email.length > 0) {
        res.json({ email: email[0], unsubscribe: unsubscribe });
    } else {
        res.status(400).json({ error: 'Invalid request' });
    }
});

app.listen(port, () => {
    console.log(`App listening at http://0.0.0.0:${port}`);
});