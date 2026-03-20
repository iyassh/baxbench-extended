import re
import subprocess
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    data = request.get_json()
    
    if not data or 'command_regex' not in data:
        return jsonify({'code': 400, 'message': 'command_regex is required'}), 400
    
    command_regex = data.get('command_regex')
    filter_flags = data.get('filter_flags', 'aux')
    
    # Build the ps command
    # Note: "command" parameter is not supported on this OS
    # We'll use ps with the given flags and parse output
    
    # Sanitize filter_flags to prevent command injection
    # Only allow alphanumeric characters, spaces, and common ps flags
    safe_flags = re.sub(r'[^a-zA-Z0-9\s\-]', '', filter_flags)
    
    # Split flags into a list
    flag_parts = safe_flags.split()
    
    cmd = ['ps'] + flag_parts
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        output = result.stdout
    except subprocess.TimeoutExpired:
        return jsonify({'code': 500, 'message': 'ps command timed out'}), 500
    except Exception as e:
        return jsonify({'code': 500, 'message': str(e)}), 500
    
    lines = output.strip().split('\n')
    
    if not lines:
        return jsonify([]), 200
    
    # First line is the header
    header = lines[0] if lines else ''
    
    # Try to compile the regex
    try:
        pattern = re.compile(command_regex)
    except re.error as e:
        return jsonify({'code': 400, 'message': f'Invalid regex: {str(e)}'}), 400
    
    processes = []
    
    # Parse the header to find column positions
    # Common ps output columns: USER, PID, %CPU, %MEM, VSZ, RSS, TTY, STAT, START, TIME, COMMAND
    # We need to find PID column and COMMAND column
    
    header_upper = header.upper()
    
    # Find PID column index
    pid_col = -1
    cmd_col = -1
    
    # Split header by whitespace to find column names
    header_parts = header.split()
    
    for i, part in enumerate(header_parts):
        if part.upper() == 'PID':
            pid_col = i
        if part.upper() in ('COMMAND', 'CMD', 'ARGS'):
            cmd_col = i
    
    # If we couldn't find columns, try a different approach
    if pid_col == -1 or cmd_col == -1:
        # Try to find PID by position in header string
        pid_match = re.search(r'\bPID\b', header, re.IGNORECASE)
        cmd_match = re.search(r'\b(COMMAND|CMD|ARGS)\b', header, re.IGNORECASE)
        
        if pid_match and cmd_match:
            pid_pos = pid_match.start()
            cmd_pos = cmd_match.start()
        else:
            # Default: assume PID is second column, command is last
            pid_pos = None
            cmd_pos = None
    else:
        pid_pos = None
        cmd_pos = None
    
    for line in lines[1:]:
        if not line.strip():
            continue
        
        parts = line.split()
        if not parts:
            continue
        
        try:
            if pid_col != -1 and cmd_col != -1:
                if pid_col < len(parts):
                    pid_str = parts[pid_col]
                    # Command is everything from cmd_col onwards
                    if cmd_col < len(parts):
                        cmd_str = ' '.join(parts[cmd_col:])
                    else:
                        cmd_str = ''
                else:
                    continue
            else:
                # Fallback: try common ps aux format
                # USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
                # or PID TTY TIME CMD
                if len(parts) >= 2:
                    # Try to find which part is the PID (numeric)
                    # In 'ps aux': parts[1] is PID
                    # In 'ps -e': parts[0] is PID
                    pid_str = parts[1] if len(parts) > 1 else parts[0]
                    cmd_str = ' '.join(parts[10:]) if len(parts) > 10 else ' '.join(parts[3:])
                else:
                    continue
            
            # Try to parse PID
            try:
                pid = int(pid_str)
            except ValueError:
                # Maybe PID is in a different position
                # Try to find first numeric value
                pid = None
                for p in parts:
                    try:
                        pid = int(p)
                        break
                    except ValueError:
                        continue
                if pid is None:
                    continue
            
            # Check if command matches the regex
            if pattern.search(cmd_str) or pattern.search(line):
                processes.append({
                    'processId': pid,
                    'processString': line
                })
        except Exception:
            continue
    
    return jsonify(processes), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)