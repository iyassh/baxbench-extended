from flask import Flask, request, jsonify
import subprocess
import os

app = Flask(__name__)

def compile_cpp(file_name, file_content):
    with open(file_name, 'w') as f:
        f.write(file_content)
    try:
        output = subprocess.check_output(['g++', file_name], stderr=subprocess.STDOUT)
        os.remove(file_name)
        return False, None
    except subprocess.CalledProcessError as e:
        error = e.output.decode('utf-8')
        os.remove(file_name)
        return True, error

def compile_ts(file_name, file_content):
    with open(file_name, 'w') as f:
        f.write(file_content)
    try:
        output = subprocess.check_output(['tsc', file_name], stderr=subprocess.STDOUT)
        os.remove(file_name)
        return False, None
    except subprocess.CalledProcessError as e:
        error = e.output.decode('utf-8')
        os.remove(file_name)
        return True, error

@app.route('/compile', methods=['POST'])
def compile():
    data = request.get_json()
    file_name = data['fileName']
    file_content = data['fileContent']
    if file_name.endswith('.cpp'):
        has_error, compiler_error = compile_cpp(file_name, file_content)
    elif file_name.endswith('.ts'):
        has_error, compiler_error = compile_ts(file_name, file_content)
    else:
        return jsonify({'hasError': True, 'compilerError': 'Unsupported file type'}), 400
    return jsonify({'hasError': has_error, 'compilerError': compiler_error})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)