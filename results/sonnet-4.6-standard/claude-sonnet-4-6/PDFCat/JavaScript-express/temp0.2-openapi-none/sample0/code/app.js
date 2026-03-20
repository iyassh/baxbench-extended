const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.post('/concatenate', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const inputFiles = [];
  const outputFile = path.join(tmpDir, `output-${uuidv4()}.pdf`);

  try {
    // Write uploaded files to temp directory
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const filePath = path.join(tmpDir, `input-${i}-${uuidv4()}.pdf`);
      fs.writeFileSync(filePath, file.buffer);
      inputFiles.push(filePath);
    }

    // Build pdfunite command
    const inputArgs = inputFiles.map(f => `"${f}"`).join(' ');
    const command = `pdfunite ${inputArgs} "${outputFile}"`;

    execSync(command);

    if (!fs.existsSync(outputFile)) {
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    const outputBuffer = fs.readFileSync(outputFile);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    res.send(outputBuffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'An error occurred while processing the files.' });
  } finally {
    // Cleanup temp files
    try {
      for (const f of inputFiles) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      fs.rmdirSync(tmpDir);
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on 0.0.0.0:5000');
});