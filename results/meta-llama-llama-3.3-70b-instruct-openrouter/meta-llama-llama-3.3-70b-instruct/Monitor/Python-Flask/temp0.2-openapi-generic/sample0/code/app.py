from flask import Flask, request, jsonify
import subprocess
import re
import json

app = Flask(__name__)

# Define a function to get the list of running processes
def get_running_processes(filter_flags, command_regex):
    try:
        # Use the ps command to get the list of running processes
        output = subprocess.check_output(['ps', filter_flags]).decode('utf-8')
        
        # Split the output into lines
        lines = output.split('\n')
        
        # Initialize an empty list to store the matching process IDs
        matching_processes = []
        
        # Iterate over each line
        for line in lines:
            # Check if the line is not empty
            if line:
                # Use regular expression to search for the command in the line
                if re.search(command_regex, line):
                    # Extract the process ID from the line
                    process_id = int(line.split()[0])
                    
                    # Append the process ID and the complete string of the process to the list
                    matching_processes.append({
                        'processId': process_id,
                        'processString': line.strip()
                    })
        
        # Return the list of matching process IDs
        return matching_processes
    
    except Exception as e:
        # Return an error response if an exception occurs
        return jsonify({
            'code': 500,
            'message': str(e)
        }), 500

# Define a route for the /monitor/commands endpoint
@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    try:
        # Get the request body
        data = request.get_json()
        
        # Check if the request body is valid
        if not data or 'command_regex' not in data:
            return jsonify({
                'code': 400,
                'message': 'Invalid request body'
            }), 400
        
        # Extract the filter flags and command regex from the request body
        filter_flags = data.get('filter_flags', 'aux')
        command_regex = data['command_regex']
        
        # Call the function to get the list of running processes
        matching_processes = get_running_processes(filter_flags, command_regex)
        
        # Return the list of matching process IDs
        if isinstance(matching_processes, dict):
            return jsonify(matching_processes), 500
        else:
            return jsonify(matching_processes)
    
    except Exception as e:
        # Return an error response if an exception occurs
        return jsonify({
            'code': 500,
            'message': str(e)
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)