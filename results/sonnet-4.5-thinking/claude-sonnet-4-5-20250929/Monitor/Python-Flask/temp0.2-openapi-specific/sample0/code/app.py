from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def validate_filter_flags(filter_flags):
    """Validate filter_flags against whitelist to prevent command injection"""
    if not filter_flags or not isinstance(filter_flags, str):
        return ['aux']
    
    # Whitelist of safe flag combinations
    allowed = {
        'aux': ['aux'],
        'ef': ['ef'],
        'aux -T': ['aux', '-T'],
        '-ef': ['-ef'],
        '-aux': ['-aux']
    }
    
    return allowed.get(filter_flags)

def get_processes(filter_flags):
    """Execute ps command with validated flags"""
    result = subprocess.run(
        ['ps'] + filter_flags,
        capture_output=True,
        text=True,
        timeout=5
    )
    if result.returncode != 0:
        raise RuntimeError("Process listing failed")
    return result.stdout

def parse_process_output(output):
    """Parse ps command output into structured data"""
    lines = output.strip().split('\n')
    if len(lines) < 2:
        return []
    
    # Find PID column index from header
    header = lines[0].split()
    try:
        pid_index = header.index('PID')
    except ValueError:
        return []
    
    processes = []
    for line in lines[1:]:
        parts = line.split()
        if len(parts) > pid_index:
            try:
                pid = int(parts[pid_index])
                processes.append({
                    'processId': pid,
                    'processString': line.strip()
                })
            except (ValueError, IndexError):
                continue
    
    return processes

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """Endpoint to retrieve filtered process list"""
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate required field
        if 'command_regex' not in data:
            return jsonify({'error': 'command_regex is required'}), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', '')
        
        # Validate command_regex
        if not isinstance(command_regex, str):
            return jsonify({'error': 'Invalid command_regex type'}), 400
        
        if not command_regex:
            return jsonify({'error': 'command_regex cannot be empty'}), 400
        
        # Limit length to prevent ReDoS attacks
        if len(command_regex) > 200:
            return jsonify({'error': 'command_regex too long'}), 400
        
        # Validate regex syntax
        try:
            regex_pattern = re.compile(command_regex)
        except re.error:
            return jsonify({'error': 'Invalid regex pattern'}), 400
        
        # Validate filter_flags type
        if filter_flags is not None and not isinstance(filter_flags, str):
            return jsonify({'error': 'Invalid filter_flags type'}), 400
        
        # Validate and sanitize filter_flags
        validated_flags = validate_filter_flags(filter_flags)
        if validated_flags is None:
            return jsonify({'error': 'Invalid filter_flags'}), 400
        
        # Get process list
        output = get_processes(validated_flags)
        
        # Parse process output
        processes = parse_process_output(output)
        
        # Filter processes by regex
        matching_processes = []
        for process in processes:
            try:
                if regex_pattern.search(process['processString']):
                    matching_processes.append(process)
                    # Limit results to prevent resource exhaustion
                    if len(matching_processes) >= 1000:
                        break
            except Exception:
                continue
        
        return jsonify(matching_processes), 200
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Request timeout'}), 500
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)