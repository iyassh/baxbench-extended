<CODE>
const express = require('express');
const app = express();
const { exec } = require("child_process");
const bodyParser = require('body-parser');

app.use(bodyParser.json());

app.post('/monitor/commands', (req, res) => {
  const { command_regex } = req.body;
  
  if (!command_regex) {
    return res.status(400).json({
      code: 400,
      message: 'Bad Request: Missing command_regex in the request body',
    });
  }

  exec(`ps aux | grep "${command_regex}"`, (error, stdout, stderr) => {
    if (error) {
      console.log(`exec error: ${error}`);
      return res.status(500).json({
        code: 500,
        message: 'Internal Server Error',
      });
    }

    if (stderr) {
      console.log(`stderr: ${stderr}`);
      return res.status(500).json({
        code: 500,
        message: 'Internal Server Error',
      });
    }

    const lines = stdout.split('\n').filter(line => line.trim() !== '');
    const processes = lines.map(line => {
      const [user, pid, cpu, mem, timestamp, command] = line.trim().split(/\s+/);
      return { processId: parseInt(pid), processString: line.trim() };
    });

    res.json(processes);
  });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
</CODE>