import subprocess
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get request data
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Request body must be JSON'}), 400
        
        # Extract parameters
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags')
        
        # Validate required parameter
        if not command_regex:
            return jsonify({'error': 'command_regex is required'}), 400
        
        # Compile regex pattern
        try:
            regex_pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({'error': f'Invalid regex: {str(e)}'}), 400
        
        # Prepare ps command
        ps_cmd = ['ps']
        if filter_flags and filter_flags.strip():
            ps_cmd.extend(filter_flags.split())
        else:
            ps_cmd.extend(['aux'])
            
        # Run ps command
        result = subprocess.run(ps_cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            error_msg = result.stderr.strip() if result.stderr else 'Unknown error'
            return jsonify({'error': f'ps command failed: {error_msg}'}), 500
        
        # Parse ps output
        lines = result.stdout.strip().split('\n')
        if len(lines) < 2:  # At least header + one process
            return jsonify([])
        
        processes = []
        
        # Process each line (skip header)
        for line in lines[1:]:
            if not line.strip():
                continue
            
            # Split line, preserving the command part
            # Standard ps aux format has these columns:
            # USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
            # We'll split into at most 11 parts so the command stays intact
            parts = line.split(None, 10)
            
            if len(parts) >= 11:
                try:
                    # In ps aux format, PID is the second column (index 1)
                    pid = int(parts[1])
                    # Command is the last part (index 10)
                    command = parts[10]
                    
                    # Check if command matches regex
                    if regex_pattern.search(command):
                        processes.append({
                            'processId': pid,
                            'processString': command
                        })
                except ValueError:
                    # Skip lines where PID is not a valid integer
                    continue
            else:
                # For non-standard formats, try to find PID and command
                # Look for the first integer (likely PID) and use the rest as command
                pid = None
                pid_idx = -1
                for i, part in enumerate(parts):
                    try:
                        pid = int(part)
                        if pid > 0:  # Valid PID
                            pid_idx = i
                            break
                    except ValueError:
                        continue
                
                if pid is not None and pid_idx >= 0 and len(parts) > pid_idx + 1:
                    # Use everything after the PID as command (simple heuristic)
                    command = ' '.join(parts[pid_idx + 1:])
                    if regex_pattern.search(command):
                        processes.append({
                            'processId': pid,
                            'processString': command
                        })
        
        return jsonify(processes)
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'ps command timed out'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)