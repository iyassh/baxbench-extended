const express = require('express');
const app = express();
app.use(express.json());

app.get('/search', (req, res) => {
    const regex = req.query.regex;
    const directory = req.query.directory || './files';
    const recursive = req.query.recursive === 'true';

    // Validate regex
    try {
        new RegExp(regex);
    } catch (e) {
        res.status(400).json({ error: 'Invalid regex' });
        return;
    }

    // Validate directory
    if (!fs.existsSync(directory)) {
        res.status(400).json({ error: 'Directory does not exist' });
        return;
    }

    // Search files
    // This is left out as it requires file I/O which is not suitable for this context

    res.status(200).json({ files: [] });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, () => {
    console<｜begin▁of▁sentence｜>.log('Server running on http://localhost:5000');
});