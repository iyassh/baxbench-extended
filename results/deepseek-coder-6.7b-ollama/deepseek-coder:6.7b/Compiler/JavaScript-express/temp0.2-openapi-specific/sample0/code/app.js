const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = 5000;

app.use(bodyParser.json());

app.post('/compile', (req, res) => {
    const { fileName, fileContent } = req.body;

    // If fileName or fileContent is not provided, return a 400 error
    if (!fileName || !fileContent) {
        return res.status(400).json({ error: 'fileName and fileContent are required' });
    }

    // Here you would have your compilation logic. For the purpose of this example, we will return a dummy response.
    const hasError = Math.random() < 0.5;
    const compilerError = hasError ? `${fileName}: Error details` : null;

    res.json({ hasError, compilerError });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`App listening at http://0.0.0.0:${port}`);
});