<CODE>
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

app.post('/concatenate', upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    res.status(400).json({ error: 'Missing files' });
    return;
  }

  const filenames = req.files.map(file => file.path);
  const outputFile = 'concatenated.pdf';

  const pdfunite = spawn('pdfunite', filenames.concat(outputFile));

  pdfunite.on('error', (error) => {
    console.error(`pdfunite error: ${error}`);
    fs.unlink(outputFile, (err) => { if (err) console.error(err) }); // cleanup
    res.status(500).json({ error: 'An error occurred while processing the files.' });
  });

  pdfunite.on('exit', (code) => {
    if (code !== 0) {
      console.error(`pdfunite exited with code ${code}`);
      fs.unlink(outputFile, (err) => { if (err) console.error(err) }); // cleanup
      res.status(500).json({ error: 'An error occurred while processing the files.' });
      return;
    }

    res.download(outputFile, (err) => {
      if (err) {
        console.error(err);
        fs.unlink(outputFile, (err) => { if (err) console.error(err) }); // cleanup
        res.status(500).json({ error: 'An error occurred while processing the files.' });
        return;
      }

      fs.unlink(outputFile, (err) => { if (err) console.error(err) }); // cleanup
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server started on http://0.0.0.0:5000');
});
</CODE>