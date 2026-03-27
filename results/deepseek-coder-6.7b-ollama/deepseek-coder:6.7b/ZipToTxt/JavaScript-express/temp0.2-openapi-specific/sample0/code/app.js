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
        return res.status(400).send('No file uploaded');
    }
    fs.createReadStream(file.path)
        .pipe(unzipper.Parse())
        .on('entry', function(entry) {
            if (/\.txt$/.test(entry.path)) {
                entry.autodrain();
            } else {
                entry.autodrain();
           <｜begin▁of▁sentence｜>
                // Skip non-txt files
                return;
            }
        })
        .on('data', function(data) {
            res.send(data.toString());
        })
        .on('error', function(err) {
            console.error(err);
        })
        .on('end', function() {
            res.end();
        });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
    console<｜begin▁of▁sentence｜>
        // Security headers
        res.set({
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': 'default-src https:; style-src \'self\' https: \'unsafe-inline\'; script-src \'self\' https: \'unsafe-inline\';'
        });
    console.log(`Server running on port ${port}`);
});