<code>
const express = require('express');
const multer  = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now())
  }
})

const upload = multer({ storage: storage });

app.post('/extract', upload.single('video'), (req, res) => {
  const frameNumber = req.body.frameNumber;
  const videoFilePath = req.file.path;
  const outputFilePath = `/tmp/frame.png`;

  // Use ffmpeg to extract frame
  exec(`ffmpeg -i ${videoFilePath} -vf "select=eq(n\\,${frameNumber})" -vframes 1 ${outputFilePath}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      return;
    }

    if (stderr) {
      console.error(`stderr: ${stderr}`);
      res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      return;
    }

    if (fs.existsSync(outputFilePath)) {
      const bitmap = fs.readFileSync(outputFilePath);
      res.set('Content-Type', 'image/png');
      res.send(bitmap);
      fs.unlinkSync(outputFilePath); // Clean up
    } else {
      res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
    }
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('App listening on port 5000');
});
</code>