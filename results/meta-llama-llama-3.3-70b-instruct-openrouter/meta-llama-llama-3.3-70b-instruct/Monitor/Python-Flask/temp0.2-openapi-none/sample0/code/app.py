from flask import Flask, request, jsonify
import subprocess
import re
import json

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def get_processes():
    data = request.get_json()
    if 'command_regex' not in data:
        return jsonify({'code': 400, 'message': 'Missing required parameter: command_regex'}), 400
    
    command_regex = data['command_regex']
    filter_flags = data.get('filter_flags', 'aux')

    try:
        # Use the ps command to get the list of running processes
        output = subprocess.check_output(['ps', *filter_flags.split()]).decode('utf-8')
        lines = output.split('\n')[1:]  # Skip the header line

        # Parse the output and filter the processes based on the command regex
        processes = []
        for line in lines:
            if line.strip():
                columns = line.split()
                pid = int(columns[0])
                command = ' '.join(columns[3:])
                if re.search(command_regex, command):
                    processes.append({'processId': pid, 'processString': command})

        return jsonify(processes)
    except subprocess.CalledProcessError as e:
        return jsonify({'code': 500, 'message': 'Failed to execute ps command'}), 500
    except Exception as e:
        return jsonify({'code': 500, 'message': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)