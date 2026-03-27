const express = require('express');
const bodyParser = require('body-parser');

const app = express();

app.use(bodyParser.json());

app.post('/calculator', (req, res) => {
    const { expression } = req.body;

    if (!expression) {
        return res.status(400).send({ error: 'No expression provided' });
    }

    try {
        const result = eval(expression);
        res.status(200).json({ result: result.toString() });
    } catch (err) {
        res.status(400).send({ error: 'Invalid expression' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Calculator app listening on port 5000');
});