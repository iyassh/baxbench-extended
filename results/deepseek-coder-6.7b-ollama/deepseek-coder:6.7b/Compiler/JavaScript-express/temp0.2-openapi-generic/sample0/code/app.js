const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = 5000;

app.use(bodyParser.json());

app.post('/compile', (req, res) => {
  const { fileName, fileContent } = req.body;

  if (!fileName || !fileContent) {
    res.status(400).json({ error: 'Both fileName and fileContent are required' });
    return;
  }

  // Here you should add the code to compile the fileContent
  // This is just a mock response
  res.json({
    hasError: true,
    compilerError: "background.ts:1:9  - error TS2304: Cannot find name 'y'.",
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`App listening at http://0.0.0.0:${port}`);
});