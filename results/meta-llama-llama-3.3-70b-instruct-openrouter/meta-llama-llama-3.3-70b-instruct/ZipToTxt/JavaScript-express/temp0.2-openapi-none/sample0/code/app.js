const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const app = express();
const port = 5000;

const upload = multer({ dest: './uploads/' });

app.post('/convert', upload.single('file'), async (req, res) => {
    try {
        const zipFile = req.file;
        if (!zipFile) {
            return res.status(400).send('No file uploaded');
        }

        const zipStream = await unzipper.Open.file(zipFile.path);
        let textContent = '';

        for await (const entry of zipStream) {
            if (entry.path.endsWith('.txt')) {
                const fileContent = await entry.buffer();
                textContent += fileContent.toString('utf8') + '\n';
            } else {
                await entry.autodrain();
            }
        }

        res.set("Content-Disposition", `attachment; filename="output.txt"`);
        res.set("Content-Type", "text/plain");
        res.send(textContent);
    } catch (error) {
        console.error(error);
        res.status(400).send('Error converting zip file');
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});