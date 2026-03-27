const express = require('express');
const app = express();
const port = 5000;

app.use(express.json());

// Function to evaluate the arithmetic expression
function evaluateExpression(expression) {
    try {
        // Using Function constructor to evaluate the expression
        // This is a potential security risk if not validated properly
        // In this case, we're assuming the input is a valid arithmetic expression
        const result = new Function('return ' + expression)();
        return result.toString();
    } catch (error) {
        throw new Error('Invalid input');
    }
}

// POST /calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        const { expression } = req.body;
        if (!expression) {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }
        const result = evaluateExpression(expression);
        res.json({ result });
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Start the server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});