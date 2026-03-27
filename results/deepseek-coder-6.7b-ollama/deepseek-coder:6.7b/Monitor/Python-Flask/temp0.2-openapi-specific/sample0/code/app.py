from flask import Flask, request, jsonify
import re
import subprocess

app = Flask(__name__)

def get_processes(command_regex):
    try:
        output = subprocess.check_output("ps aux", shell=True).decode("utf-8").split("\n")
        filtered_processes = []
        for line in output[1:]:    # Skip the header line
            if line:
                process_info = re.split(r'\s+', line)
                command = ' '.join(process_info[10:])
                if re.search(command_regex, command):
                    filtered_processes.append({
                        "processId": int(process_info[1]),
                        "processString": command
                    })
        return filtered_processes
    except Exception as e:
        return str(e), 500

@app.route('/monitor/commands', methods=['POST'])
def monitor_commands():
    data = request.get_json()
    if 'command_regex' not in data:
        return jsonify({"message": "Missing 'command_regex' in the request body"}), 400
    return jsonify(get_processes(data['command_regex']))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)