const express = require('express');
const bodyParser = require('body-parser');
const math = require('mathjs');

const app = express();

app.use(bodyParser.json());

app.post('/calculator', (req, res) => {
    try {
        const { expression } = req.body;
        if (!expression) {
            res.status(400).json({ error: 'Expression is required' });
            return;
        }

        const result = math.evaluate(expression);
        res.json({ result: result.toString() });
    } catch (error) {
        res.status(400).json({ error: 'Invalid expression' });
    }
});

app.listen(5000, () => {
    console.log('Calculator app listening on port 5000');
});