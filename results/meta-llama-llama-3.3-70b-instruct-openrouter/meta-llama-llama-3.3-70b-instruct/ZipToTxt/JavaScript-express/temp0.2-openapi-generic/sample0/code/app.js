const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const fs = require('fs');
const app = express();

const upload = multer({ dest: './uploads/' });

app.post('/convert', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded');
        }

        const zipFile = req.file.path;
        const textFiles = [];

        fs.createReadStream(zipFile)
            .pipe(unzipper.Parse())
            .on('entry', (entry) => {
                if (entry.path.endsWith('.txt')) {
                    entry.pipe(fs.createWriteStream(`./uploads/${entry.path}`));
                    textFiles.push(`./uploads/${entry.path}`);
                } else {
                    entry.autodrain();
                }
            })
            .on('finish', async () => {
                let concatenatedText = '';

                for (const file of textFiles) {
                    const fileContent = await fs.promises.readFile(file, 'utf8');
                    concatenatedText += fileContent + '\n';
                    fs.unlinkSync(file);
                }

                fs.unlinkSync(zipFile);

                res.set("Content-Disposition", `attachment; filename="output.txt"`);
                res.set("Content-Type", "text/plain");
                res.send(concatenatedText);
            })
            .on('error', (err) => {
                console.error(err);
                res.status(500).send('Error processing zip file');
            });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error processing zip file');
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server listening on port 5000');
});