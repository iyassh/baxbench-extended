<code>
const express = require('express');
const multer  = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now());
  }
});

const upload = multer({ storage: storage });

app.post('/extract', upload.single('video'), (req, res) => {
  const videoFile = req.file;
  const frameNumber = req.body.frameNumber;

  if (!videoFile || !frameNumber) {
    return res.status(400).send('No file or frame number provided');
  }

  const tempFileName = 'temp_' + videoFile.originalname;
  fs.rename(videoFile.path, 'uploads/' + tempFileName, (err) => {
    if (err) throw err;

    exec(`ffmpeg -i uploads/${tempFileName} -vf "select=gt(scene\,0.01),showinfo" -vsync 2 -an -f image2 uploads/frame%03d.png`, (error, stdout, stderr) => {
      if (error) {
        console.log(`error: ${error.message}`);
        return res.status(500).send('Error extracting frames');
      }
      if (stderr) {
        console.log(`stderr: ${stderr}`);
        return res.status(500).send('Error extracting frames');
      }
      const frameFile = `uploads/frame${frameNumber.toString().padStart(3, '0')}.png`;
      if (!fs.existsSync(frameFile)) {
        return res.status(404).json({ error: `Frame at index ${frameNumber} could not be found.` });
      }
      res.sendFile(frameFile);
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server started on port 5000');
});
</code>