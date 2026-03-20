const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 5000;
const FILES_ROOT = './files';

// Middleware for JSON parsing
app.use(express.json());

// Helper function to validate regex
function isValidRegex(pattern) {
    try {
        new RegExp(pattern);
        return true;
    } catch (e) {
        return false;
    }
}

// Helper function to search files recursively
async function searchFiles(directory, regex, recursive) {
    const results = [];
    
    try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            
            if (entry.isDirectory() && recursive) {
                // Recursively search subdirectories
                const subResults = await searchFiles(fullPath, regex, recursive);
                results.push(...subResults);
            } else if (entry.isFile()) {
                try {
                    // Read file content
                    const content = await fs.readFile(fullPath, 'utf-8');
                    
                    // Test if content matches regex
                    if (regex.test(content)) {
                        // Calculate relative path from the search directory
                        const relativePath = path.relative(directory, fullPath);
                        results.push(relativePath || entry.name);
                    }
                } catch (readError) {
                    // Skip files that cannot be read as text
                    console.error(`Could not read file ${fullPath}: ${readError.message}`);
                }
            }
        }
    } catch (error) {
        throw new Error(`Failed to read directory: ${error.message}`);
    }
    
    return results;
}

// Search endpoint
app.get('/search', async (req, res) => {
    try {
        const { regex: regexPattern, directory = '', recursive = 'false' } = req.query;
        
        // Validate regex parameter is provided
        if (!regexPattern) {
            return res.status(400).json({ 
                error: 'Missing required parameter: regex' 
            });
        }
        
        // Validate regex pattern
        if (!isValidRegex(regexPattern)) {
            return res.status(400).json({ 
                error: 'Invalid regex pattern' 
            });
        }
        
        // Create regex object
        const regex = new RegExp(regexPattern);
        
        // Parse recursive parameter
        const isRecursive = recursive === 'true';
        
        // Sanitize and validate directory path
        const normalizedDir = path.normalize(directory || '');
        
        // Prevent directory traversal attacks
        if (normalizedDir.includes('..')) {
            return res.status(400).json({ 
                error: 'Invalid directory path: directory traversal not allowed' 
            });
        }
        
        // Construct full search path
        const searchPath = path.join(FILES_ROOT, normalizedDir);
        
        // Verify the search path exists and is a directory
        try {
            const stats = await fs.stat(searchPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ 
                    error: 'Specified path is not a directory' 
                });
            }
        } catch (error) {
            return res.status(400).json({ 
                error: 'Directory does not exist or is not accessible' 
            });
        }
        
        // Ensure search path is within FILES_ROOT
        const resolvedSearchPath = path.resolve(searchPath);
        const resolvedFilesRoot = path.resolve(FILES_ROOT);
        if (!resolvedSearchPath.startsWith(resolvedFilesRoot)) {
            return res.status(400).json({ 
                error: 'Invalid directory path: outside of files root' 
            });
        }
        
        // Perform the search
        const matchingFiles = await searchFiles(searchPath, regex, isRecursive);
        
        // Return results
        res.status(200).json({ 
            files: matchingFiles 
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            error: 'Internal server error occurred during search' 
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error' 
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`File search API server running on http://0.0.0.0:${PORT}`);
    console.log(`Files root directory: ${path.resolve(FILES_ROOT)}`);
});