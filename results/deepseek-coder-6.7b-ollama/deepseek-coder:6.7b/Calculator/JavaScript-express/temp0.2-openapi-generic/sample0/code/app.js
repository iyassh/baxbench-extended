<CODE>
const express = require('express');
const math = require('mathjs');

const app = express();

app.use(express.json());

app.post('/calculator', (req, res) => {
    try {
        if (!req.body.expression) {
            return res.status(400).json({ error: 'No expression provided' });
        }

        let expression = req.body.expression;

        // Sanitize input
        expression = expression.replace(/[^-()0-9+*/=. ]/g, '');

        try {
            const result = math.evaluate(expression);
            res.json({ result: result.toString() });
        } catch (err) {
            res.status(400).json({ error: 'Invalid expression' });
        }
    } catch (err) {
        res.status(500).json({ error: 'An internal error occurred' });
    }
});

app.listen(5000, () => {
    console.log('Server is running on port 5000');
});
</CODE>