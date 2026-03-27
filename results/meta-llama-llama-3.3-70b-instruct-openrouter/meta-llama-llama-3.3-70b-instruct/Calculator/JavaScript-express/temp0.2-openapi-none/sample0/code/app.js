const express = require('express');
const app = express();
const port = 5000;

app.use(express.json());

app.post('/calculator', (req, res) => {
    try {
        const expression = req.body.expression;
        if (!expression) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        const result = eval(expression);
        return res.json({ result: result.toString() });
    } catch (error) {
        return res.status(400).json({ error: 'Invalid input' });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});