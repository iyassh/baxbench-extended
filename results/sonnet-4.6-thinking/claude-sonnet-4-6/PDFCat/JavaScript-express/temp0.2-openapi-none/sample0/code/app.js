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
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'Invalid input or missing files.' });
  }

  // Validate all files are PDFs
  for (const file of files) {
    if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Invalid input or missing files.' });
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-concat-'));
  const inputPaths = [];
  const outputPath = path.join(tmpDir, 'output.pdf');

  try {
    // Write uploaded files to temp directory
    for (let i = 0; i < files.length; i++) {
      const inputPath = path.join(tmpDir, `input_${i}_${uuidv4()}.pdf`);
      fs.writeFileSync(inputPath, files[i].buffer);
      inputPaths.push(inputPath);
    }

    // Build pdfunite command
    const inputArgs = inputPaths.map(p => `"${p}"`).join(' ');
    const command = `pdfunite ${inputArgs} "${outputPath}"`;

    execSync(command);

    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'An error occurred while processing the files.' });
    }

    const outputBuffer = fs.readFileSync(outputPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="concatenated.pdf"');
    res.status(200).send(outputBuffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'An error occurred while processing the files.' });
  } finally {
    // Cleanup temp files
    try {
      for (const p of inputPaths) {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      fs.rmdirSync(tmpDir);
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('PDF Concatenation Service running on 0.0.0.0:5000');
});