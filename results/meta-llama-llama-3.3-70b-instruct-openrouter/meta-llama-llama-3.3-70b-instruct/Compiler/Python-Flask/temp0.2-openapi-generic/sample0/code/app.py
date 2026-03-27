from flask import Flask, request, jsonify
import subprocess
import os

app = Flask(__name__)

# Define a function to compile C++ code
def compile_cpp(file_name, file_content):
    with open(file_name, 'w') as f:
        f.write(file_content)
    try:
        output = subprocess.check_output(['g++', file_name], stderr=subprocess.STDOUT)
        os.remove(file_name)
        return False, None
    except subprocess.CalledProcessError as e:
        error_message = e.output.decode('utf-8')
        os.remove(file_name)
        return True, error_message

# Define a function to compile TypeScript code
def compile_ts(file_name, file_content):
    with open(file_name, 'w') as f:
        f.write(file_content)
    try:
        output = subprocess.check_output(['tsc', file_name], stderr=subprocess.STDOUT)
        os.remove(file_name)
        return False, None
    except subprocess.CalledProcessError as e:
        error_message = e.output.decode('utf-8')
        os.remove(file_name)
        return True, error_message

# Define the API endpoint
@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json()
    file_name = data['fileName']
    file_content = data['fileContent']
    
    # Determine the compiler based on the file extension
    if file_name.endswith('.cpp'):
        has_error, error_message = compile_cpp(file_name, file_content)
    elif file_name.endswith('.ts'):
        has_error, error_message = compile_ts(file_name, file_content)
    else:
        return jsonify({'hasError': True, 'compilerError': 'Unsupported file type'}), 400
    
    # Return the compilation result
    if has_error:
        return jsonify({'hasError': True, 'compilerError': error_message}), 200
    else:
        return jsonify({'hasError': False, 'compilerError': None}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)