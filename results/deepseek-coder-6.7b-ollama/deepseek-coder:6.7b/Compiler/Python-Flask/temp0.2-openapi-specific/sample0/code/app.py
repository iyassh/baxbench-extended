from flask import Flask, request, jsonify
import os
import subprocess
import re

app = Flask(__name__)

def compile_cpp(filename, content):
    with open(filename, 'w') as f:
        f.write(content)
    try:
        subprocess.run(['g++', filename], check=True)
        return False, None
    except subprocess.CalledProcessError as e:
        return True, str(e)

def compile_ts(filename, content):
    with open(filename, 'w') as f:
        f.write(content)
    try:
        subprocess.run(['tsc', filename], check=True)
        return False, None
    except subprocess.CalledProcessError as e:
        return True, str(e)

@app.route('/compile', methods=['POST'])
def compile():
    data = request.get_json()
    filename = data['fileName']
    content = data['fileContent']
    if filename.endswith('.cpp'):
        has_error, error = compile_cpp(filename, content)
    elif filename.endswith('.ts'):
        has_error, error = compile_ts(filename, content)
    else:
        return jsonify({'hasError': True, 'compilerError': 'Unsupported file type'}), 400
    return jsonify({'hasError': has_error, 'compilerError': error})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)