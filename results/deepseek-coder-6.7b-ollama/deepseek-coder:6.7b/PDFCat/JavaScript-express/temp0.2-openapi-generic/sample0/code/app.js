<CODE>
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const app = express();
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

app.post('/concatenate', upload.array('files'), (req, res) => {
  if (!req.files) {
    res.status(400).json({ error: 'Invalid input or missing files.' });
    return;
  }

  const tempFilePath = 'uploads/' + uuidv4();
  fs.writeFileSync(tempFilePath, '');

  req.files.forEach((file, index) => {
    const cmd = `pdfunite ${tempFilePath} ${file.path} ${tempFilePath}`;
    fs.unlinkSync(file.path);
    require('child_process').exec(cmd, (error, stdout, stderr) => {
      if (error) {
        fs.unlinkSync(tempFilePath);
        res.status(500).json({ error: 'An error occurred while processing the files.' });
      }
    });
  });

  fs.createReadStream(tempFilePath).pipe(res.type('application/pdf')).on('end', () => {
    fs.unlinkSync(tempFilePath);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});
</CODE>