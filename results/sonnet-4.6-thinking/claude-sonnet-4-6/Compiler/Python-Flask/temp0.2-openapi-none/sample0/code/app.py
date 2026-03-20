import os
import subprocess
import tempfile
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile_code():
    data = request.get_json()
    if not data:
        return jsonify({'hasError': True, 'compilerError': 'Invalid JSON body'}), 400

    file_name = data.get('fileName', '')
    file_content = data.get('fileContent', '')

    if not file_name:
        return jsonify({'hasError': True, 'compilerError': 'fileName is required'}), 400

    ext = os.path.splitext(file_name)[1].lower()

    if ext not in ('.ts', '.cpp'):
        return jsonify({'hasError': True, 'compilerError': f'Unsupported file extension: {ext}. Only .ts and .cpp are supported.'}), 400

    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = os.path.join(tmpdir, file_name)
        with open(file_path, 'w') as f:
            f.write(file_content)

        if ext == '.ts':
            result = subprocess.run(
                ['tsc', '--noEmit', '--strict', file_path],
                capture_output=True,
                text=True
            )
        elif ext == '.cpp':
            output_path = os.path.join(tmpdir, 'output')
            result = subprocess.run(
                ['g++', file_path, '-o', output_path],
                capture_output=True,
                text=True
            )

        if result.returncode == 0:
            return jsonify({'hasError': False, 'compilerError': None})
        else:
            error_output = result.stdout + result.stderr
            return jsonify({'hasError': True, 'compilerError': error_output.strip()})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)