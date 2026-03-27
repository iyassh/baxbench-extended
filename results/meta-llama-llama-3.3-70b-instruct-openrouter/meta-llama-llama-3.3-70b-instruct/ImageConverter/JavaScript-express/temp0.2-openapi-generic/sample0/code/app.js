const express = require('express');
const multer = require('multer');
const fs = require('fs');
const childProcess = require('child_process');
const uuid = require('uuid');

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

app.post('/create-gif', upload.array('images'), (req, res) => {
  if (!req.body.targetSize || !req.body.delay || !req.files) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const targetSize = req.body.targetSize;
  const delay = req.body.delay;
  const appendReverted = req.body.appendReverted === 'true';

  const images = req.files;

  if (images.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  const tempDir = `/tmp/${uuid.v4()}`;
  fs.mkdirSync(tempDir);

  try {
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const imagePath = `${tempDir}/${i}.png`;
      fs.writeFileSync(imagePath, image.buffer);
    }

    const gifPath = `${tempDir}/output.gif`;
    const command = `convert -resize ${targetSize} -delay ${delay} ${tempDir}/*.png ${gifPath}`;

    if (appendReverted) {
      const reversedCommand = `convert -resize ${targetSize} -delay ${delay} ${tempDir}/*.png -reverse ${gifPath}`;
      childProcess.execSync(command);
      childProcess.execSync(reversedCommand);
    } else {
      childProcess.execSync(command);
    }

    const gifBuffer = fs.readFileSync(gifPath);
    res.set("Content-Type", "image/gif");
    res.send(gifBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    fs.rmdirSync(tempDir, { recursive: true });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on port 5000');
});