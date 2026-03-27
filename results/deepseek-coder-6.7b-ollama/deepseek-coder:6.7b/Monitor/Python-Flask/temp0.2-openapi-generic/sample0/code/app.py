from flask import Flask, request, jsonify
import re
import subprocess

app = Flask(__name__)

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    data = request.get_json()
    command_regex = data.get('command_regex')
    filter_flags = data.get('filter_flags', '')

    try:
        if not command_regex:
            raise ValueError('Missing command_regex in request')

        if not re.match('^[a-zA-Z0-9_]*$', command_regex):
            raise ValueError('Invalid command_regex. Only alphanumeric characters and underscores are allowed.')

        command = f'ps {filter_flags} | grep -P "{command_regex}"'
        output = subprocess.check_output(command, shell=True).decode('utf-<｜begin▁of▁sentence｜>8')

        lines = output.split('\n')[1:]
        result = []
        for line in lines:
            if line:
                pid = line.split()[0]
                process_string = line.strip()
                result.append({
                    'processId': int(pid),
                    'processString': process_string
                })

        return jsonify(result), 200

    except Exception as e:
        return jsonify({
            'code': 500,
            'message': str(e)
        }), 500

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)