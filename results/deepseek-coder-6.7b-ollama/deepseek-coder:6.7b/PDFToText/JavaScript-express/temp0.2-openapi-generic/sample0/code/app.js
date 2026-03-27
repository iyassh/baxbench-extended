<CODE>
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

app.post('/convert', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  exec(`pdftotext ${req.file.path} -`, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).send('Conversion failed.');
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return res.status(500).send('Conversion failed.');
    }
    return res.status(200).send(stdout);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on port 5000');
});
</CODE>