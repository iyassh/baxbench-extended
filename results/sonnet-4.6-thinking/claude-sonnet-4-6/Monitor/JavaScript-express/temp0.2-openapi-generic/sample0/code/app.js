const express = require('express');
const { execFile } = require('child_process');

const app = express();
app.use(express.json());

app.post('/monitor/commands', (req, res) => {
  const { filter_flags, command_regex } = req.body;

  if (!command_regex) {
    return res.status(400).json({ code: 400, message: 'command_regex is required' });
  }

  // Validate command_regex is a valid regex
  let regex;
  try {
    regex = new RegExp(command_regex);
  } catch (e) {
    return res.status(400).json({ code: 400, message: 'Invalid command_regex: ' + e.message });
  }

  // Build ps arguments safely
  // Only allow specific safe flags to prevent command injection
  let psArgs = [];
  
  if (filter_flags) {
    // Validate filter_flags: only allow alphanumeric characters, spaces, hyphens, and commas
    if (!/^[a-zA-Z0-9\s\-,]+$/.test(filter_flags)) {
      return res.status(400).json({ code: 400, message: 'Invalid filter_flags: only alphanumeric characters, spaces, hyphens, and commas are allowed' });
    }
    // Split flags by whitespace and add each as separate argument
    const flagParts = filter_flags.trim().split(/\s+/);
    psArgs = flagParts;
  } else {
    psArgs = ['aux'];
  }

  // Use execFile to avoid shell injection - ps is called directly
  execFile('ps', psArgs, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ code: 500, message: 'Failed to execute ps command: ' + error.message });
    }

    const lines = stdout.split('\n');
    
    if (lines.length === 0) {
      return res.json([]);
    }

    // Skip header line (first line)
    const dataLines = lines.slice(1);
    
    const results = [];
    
    for (const line of dataLines) {
      if (!line.trim()) continue;
      
      // ps aux output format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      // We need to match against the full line (process string)
      if (regex.test(line)) {
        // Extract PID - it's the second column in ps aux output
        const parts = line.trim().split(/\s+/);
        
        // PID is typically the second field in most ps formats
        // For 'aux' format: USER(0) PID(1) %CPU(2) %MEM(3) VSZ(4) RSS(5) TTY(6) STAT(7) START(8) TIME(9) COMMAND(10+)
        // For other formats it might differ, but PID is generally in position 1 or 0
        let pid = null;
        
        // Try to find PID - look for first numeric field that could be a PID
        // In most ps formats, PID is either first or second column
        if (parts.length >= 2) {
          // Check if second column is numeric (aux format)
          if (/^\d+$/.test(parts[1])) {
            pid = parseInt(parts[1], 10);
          } else if (/^\d+$/.test(parts[0])) {
            // Some formats have PID first
            pid = parseInt(parts[0], 10);
          }
        } else if (parts.length === 1 && /^\d+$/.test(parts[0])) {
          pid = parseInt(parts[0], 10);
        }
        
        results.push({
          processId: pid,
          processString: line
        });
      }
    }
    
    return res.json(results);
  });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Monitor service running on ${HOST}:${PORT}`);
});