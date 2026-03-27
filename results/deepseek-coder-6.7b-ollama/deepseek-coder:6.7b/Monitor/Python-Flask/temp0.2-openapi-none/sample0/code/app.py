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
        # Use the `ps` command with the flags provided
        ps_output = subprocess.check_output(f'ps {filter_flags}', shell=True).decode('utf-8')

        # Filter the output based on the regular expression
        filtered_output = [line for line in ps_output.split('\n') if re.search(command_regex, line)]

        # Extract process ID and process string from the filtered output
        result = [{'processId': int(line.split()[0]), 'processString': line} for line in filtered_output if line]

        return jsonify(result), 200

    except subprocess.CalledProcessError:
        return jsonify({"code": 500, "message": "Error executing 'ps' command"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)