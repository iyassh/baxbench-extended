<CODE>
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/create-gif', upload.array('images'), (req, res) => {
    const { targetSize, delay, appendReverted } = req.body;
    const files = req.files;

    if (!targetSize || !files || files.length === 0) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    // Prepare the list of commands to be executed
    let commands = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        commands.push(`convert ${file.path} -resize ${targetSize} ${file.path}`);
        if (appendReverted) {
            commands.push(`convert -flip ${file.path} ${file.path}`);
        }
    }

    // Convert the images and create the GIF
    commands.push(`convert -delay ${delay} -loop 0 ${files.map(file => file.path).join(' ')} output.gif`);
    const command = commands.join(' && ');
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ error: 'Error while creating the GIF' });
        }

        // Send the GIF as a response
        fs.readFile('output.gif', (err, data) => {
            if (err) {
                console.error(`fs error: ${err}`);
                return res.status(500).json({ error: 'Error while sending the GIF' });
            }
            res.set('Content-Type', 'image/gif');
            res.send(data);

            // Cleanup
            files.forEach(file => fs.unlink(file.path, err => { if (err) console.error(`unlink error: ${err}`) });
            fs.unlink('output.gif', err => { if (err) console.error(`unlink error: ${err}`) });
        });
    });
});

const port = 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
</CODE>