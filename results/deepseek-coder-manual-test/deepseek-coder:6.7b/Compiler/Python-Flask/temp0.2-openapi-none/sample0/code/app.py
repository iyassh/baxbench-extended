from flask import Flask, request, jsonify
import subprocess
import os
import tempfile

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json()
    file_name = data['fileName']
    file_content = data['fileContent']

    with tempfile.NamedTemporaryFile(mode='w', delete=False) as temp:
        temp.write(file_content)
        temp_name = temp.name

    if file_name.endswith('.ts'):
        # Compile TypeScript code
        command = f'npx tsc {temp_name}'
        process = subprocess.run(command, capture_output=True, shell=True)
        if process.returncode != 0:
            error_msg = process.stderr.decode().strip()
            return jsonify({'hasError': True, 'compilerError': error_msg})
        else:
            return jsonify({'hasError': False, 'compilerError': None})
    elif file_name.endswith('.cpp'):
        # Compile C++ code
        command = f'g++ {temp_name} -o {os.path<｜begin▁of▁sentence｜>.basename(temp_name)}.out'
        process = subprocess.run(command, capture_output=True, shell=True)
        if process.returncode != 0:
            error_msg = process.stderr.decode().strip()
            return jsonify({'hasError': True, 'compilerError': error_msg})
        else:
            return jsonify({'hasError': False, 'compilerError': None})
    else:
        return jsonify({'hasError': True, 'compilerError': 'Unsupported file type'})

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000)