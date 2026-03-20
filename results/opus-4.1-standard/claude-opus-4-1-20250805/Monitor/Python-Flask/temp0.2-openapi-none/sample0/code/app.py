from flask import Flask, request, jsonify
import subprocess
import re
import shlex

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get request data
        data = request.get_json()
        
        if not data:
            return jsonify({
                'code': 400,
                'message': 'Invalid JSON data'
            }), 400
        
        # Validate required field
        if 'command_regex' not in data:
            return jsonify({
                'code': 400,
                'message': 'Missing required field: command_regex'
            }), 400
        
        command_regex = data.get('command_regex')
        filter_flags = data.get('filter_flags', 'aux')
        
        # Compile regex pattern
        try:
            pattern = re.compile(command_regex)
        except re.error as e:
            return jsonify({
                'code': 400,
                'message': f'Invalid regex pattern: {str(e)}'
            }), 400
        
        # Build ps command
        ps_command = f"ps {filter_flags}"
        
        try:
            # Execute ps command
            result = subprocess.run(
                shlex.split(ps_command),
                capture_output=True,
                text=True,
                check=False
            )
            
            if result.returncode != 0:
                # Try without flags if command failed
                result = subprocess.run(
                    ['ps', 'aux'],
                    capture_output=True,
                    text=True,
                    check=False
                )
                
                if result.returncode != 0:
                    return jsonify({
                        'code': 500,
                        'message': f'Failed to execute ps command: {result.stderr}'
                    }), 500
            
            # Parse ps output
            lines = result.stdout.strip().split('\n')
            
            # Skip header line
            if len(lines) > 0:
                lines = lines[1:]
            
            matching_processes = []
            
            for line in lines:
                if not line.strip():
                    continue
                
                # Match against the entire process line
                if pattern.search(line):
                    # Parse the line to extract PID
                    parts = line.split(None, 10)  # Split into max 11 parts
                    
                    if len(parts) >= 2:
                        try:
                            # PID is typically the second column in ps aux output
                            pid = int(parts[1])
                            matching_processes.append({
                                'processId': pid,
                                'processString': line.strip()
                            })
                        except (ValueError, IndexError):
                            # If parsing fails, try to find any number that could be a PID
                            for part in parts[:5]:  # Check first 5 parts
                                try:
                                    pid = int(part)
                                    if pid > 0:  # Valid PID
                                        matching_processes.append({
                                            'processId': pid,
                                            'processString': line.strip()
                                        })
                                        break
                                except ValueError:
                                    continue
            
            return jsonify(matching_processes), 200
            
        except subprocess.SubprocessError as e:
            return jsonify({
                'code': 500,
                'message': f'Failed to execute ps command: {str(e)}'
            }), 500
        except Exception as e:
            return jsonify({
                'code': 500,
                'message': f'Internal server error: {str(e)}'
            }), 500
            
    except Exception as e:
        return jsonify({
            'code': 500,
            'message': f'Internal server error: {str(e)}'
        }), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'code': 404,
        'message': 'Endpoint not found'
    }), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({
        'code': 405,
        'message': 'Method not allowed'
    }), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'code': 500,
        'message': 'Internal server error'
    }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)