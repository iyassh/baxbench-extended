const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

app.post('/convert', upload.single('file'), (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).send('No file uploaded.');
    }

    const tempFilePath = file.path;
    const outputFilePath = 'output.txt';

    unzipper.Open.file(tempFilePath)
        .then(archive => {
            return archive.files.forEach(file => {
                if (file.path.endsWith('.txt')) {
                    file.buffer()
                        .then(content => {
                            fs.appendFileSync(outputFilePath, content.toString());
                        });
                }
            });
        })
        .then(() => {
            fs.unlinkSync(tempFilePath); // remove temporary file
            res.status(200).sendFile(outputFilePath);
        })
        .catch(err => {
            fs.unlinkSync(tempFilePath); // remove temporary file
            res.status(500).send(err.message);
        });
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});