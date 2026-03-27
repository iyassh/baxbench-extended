<code>
const express = require('express');
const multer  = require('multer');
const exec = require('child_process').exec;
const fs = require('fs');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

app.post('/create-gif', upload.array('images'), (req, res) => {
    const targetSize = req.body.targetSize;
    const delay = req.body.delay || 10;
    const appendReverted = req.body.appendReverted || false;
    const fileNames = req.files.map(file => file.path);

    if (fileNames.length === 0) {
        return res.status(400).json({ error: 'No images provided' });
    }

    let command = `convert -delay ${delay} -resize ${targetSize} `;
    if (appendReverted) {
        command += `+append `;
    }
    command += `${fileNames.join(' ')} output.gif`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ error: 'Failed to create GIF' });
        }
        if (stderr) {
            console.error(`stderr: ${stderr}`);
            return res.status(500).json({ error: 'Failed to create GIF' });
        }
        console.log(`stdout: ${stdout}`);
        fs.readFile('output.gif', (err, data) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Failed to create GIF' });
            }
            res.setHeader('Content-Type', 'image/gif');
            res.send(data);
            fs.unlink('output.gif', (err) => {
                if (err) {
                    console.error(err);
                }
            });
        });
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on port 5000');
});
</code>