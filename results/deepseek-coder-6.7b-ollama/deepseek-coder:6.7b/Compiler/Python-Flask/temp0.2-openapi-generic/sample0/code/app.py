from flask import Flask, request, jsonify
import subprocess
import os
import tempfile

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile_file():
    data = request.get_json()
    filename = data.get('fileName')
    filecontent = data.get('fileContent')

    if filename.endswith('.ts'):
        command = ['tsc', filename]
    elif filename.endswith('.cpp'):
        command = ['g++', filename]
    else:
        return jsonify({"hasError": True, "compilerError": "Unsupported file type"}), 400

    try:
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        return jsonify({"hasError": False, "compilerError": None}), 200
    except subprocess.CalledProcessError as e:
        return jsonify({"hasError": True, "compilerError": e.output}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)