from flask import Flask, request, jsonify
import subprocess
import re

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 8192  # 8KB max request size

@app.after_request
def add_security_headers(response):
    """Add security headers"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

def validate_ps_flags(flags):
    """Validate ps command flags to prevent injection"""
    if not isinstance(flags, str):
        return 'aux'
        
    flags = flags.strip()
    
    # Length limit
    if len(flags) > 30:
        raise ValueError("flags too long")
    
    # Character whitelist
    if not re.match(r'^[a-zA-Z0-9\s\-]+$', flags):
        raise ValueError("invalid characters in flags")
    
    # Split and validate each part
    parts = flags.split()
    validated = []
    
    # Allowed individual flags
    safe_flags = set('auxeflwcTHLMNSrnhgpo')
    safe_dash_flags = {'-a', '-u', '-x', '-e', '-f', '-l', '-w', '-c', '-T', 
                       '-H', '-L', '-M', '-N', '-S', '-r', '-n', '-h', '-g', 
                       '-p', '-o'}
    
    for part in parts:
        if not part:
            continue
            
        if part.startswith('-'):
            if part not in safe_dash_flags:
                raise ValueError(f"invalid flag {part}")
            validated.append(part)
        else:
            # Combined flags like 'aux'
            if all(c in safe_flags for c in part):
                validated.append(part)
            else:
                raise ValueError(f"invalid flag combination {part}")
    
    return ' '.join(validated) if validated else 'aux'

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    """Get running processes matching a regex"""
    try:
        # Check content type
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
            
        # Parse JSON
        try:
            data = request.get_json()
        except Exception:
            return jsonify({"error": "Invalid JSON"}), 400
            
        if not data:
            return jsonify({"error": "Empty request body"}), 400
        
        # Validate command_regex (required)
        command_regex = data.get('command_regex')
        if not command_regex:
            return jsonify({"error": "command_regex is required"}), 400
            
        if not isinstance(command_regex, str):
            return jsonify({"error": "command_regex must be string"}), 400
            
        # Prevent ReDoS by limiting regex length
        if len(command_regex) > 100:
            return jsonify({"error": "command_regex too long"}), 400
        
        # Validate filter_flags (optional)
        filter_flags = data.get('filter_flags', 'aux')
        
        try:
            clean_flags = validate_ps_flags(filter_flags)
        except ValueError as e:
            return jsonify({"error": f"Invalid filter_flags: {e}"}), 400
        
        # Execute ps command safely
        ps_cmd = ['ps'] + clean_flags.split()
        
        try:
            proc = subprocess.run(
                ps_cmd,
                capture_output=True,
                text=True,
                timeout=8,
                check=False
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "ps command timeout"}), 500
        except Exception:
            return jsonify({"error": "ps command failed"}), 500
            
        if proc.returncode != 0:
            return jsonify({"error": "ps execution error"}), 500
            
        # Parse ps output
        output = proc.stdout.strip()
        if not output:
            return jsonify([])
            
        lines = output.split('\n')
        if len(lines) < 2:  # Need header + at least one process
            return jsonify([])
            
        # Compile regex with safety check
        try:
            pattern = re.compile(command_regex)
        except re.error:
            return jsonify({"error": "Invalid regex"}), 400
        
        processes = []
        count = 0
        max_results = 500  # Limit results
        
        # Process lines (skip header)
        for line in lines[1:]:
            if count >= max_results:
                break
                
            line = line.strip()
            if not line:
                continue
                
            try:
                # Test regex match
                if pattern.search(line):
                    # Extract PID (usually 2nd column)
                    cols = line.split()
                    if len(cols) >= 2:
                        try:
                            # Try to parse PID from second column
                            pid = int(cols[1])
                            if pid > 0:  # Valid PID
                                processes.append({
                                    "processId": pid,
                                    "processString": line
                                })
                                count += 1
                        except ValueError:
                            # PID parsing failed, skip this line
                            continue
                            
            except re.error:
                # Regex search failed, skip
                continue
        
        return jsonify(processes)
        
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(413)
def payload_too_large(error):
    return jsonify({"error": "Request too large"}), 413

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)