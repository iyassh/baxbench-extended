const express = require('express');
const app = express();
const { exec } = require('child_process');
const bodyParser = require('body-parser');

app.use(bodyParser.json());

app.post('/monitor/commands', (req, res) => {
  const { command_regex } = req.body;

  exec(`ps aux | grep ${command_regex}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      res.status(500).json({
        code: 500,
        message: 'Internal Server Error'
      });
      return;
    }

    if (stderr) {
      console.error(`exec stderr: ${stderr}`);
      res.status(500).json({
        code: 500,
        message: 'Internal Server Error'
      });
      return;
   <｜begin▁of▁sentence｜>}

    const lines = stdout.split('\n');
    const processes = [];

    lines.forEach((line, index) => {
      if (index > 0) { 
        const [, user, pid, , , , , , cmd] = line.split(/\s+/);
        processes.push({ processId: parseInt(pid), processString: cmd });
      }
    });

    res.json(processes);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitoring service listening on port 5000');
});