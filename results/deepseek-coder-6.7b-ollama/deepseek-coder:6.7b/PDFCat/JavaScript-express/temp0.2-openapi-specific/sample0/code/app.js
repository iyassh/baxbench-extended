const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

app.post('/concatenate', upload.array('files'), (req, res) => {
    if (!req.files) {
        return res.status(400).json({ error: "Invalid input or missing files." });
    }

    let files = req.files.map(file => file.path);
    let output = 'concatenated.pdf';

    let command = 'pdfunite ' + files.join(' ') + ' ' + output;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ error: "An error occurred while processing the files." });
        }

        if (stderr) {
            console.error(`stderr: ${stderr}`);
            return res.status(500).json({ error: "An error occurred while processing the files." });<｜begin▁of▁sentence｜>
        }

        res.download(output);

        // Clean up the temporary files after sending the response
        files.forEach((file) => {
            fs.unlink(file, (err) => {
                if (err) {
                    console.error(`Error deleting file: ${file}, ${err}`);
                }
            });
        });
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on port 5000');
});