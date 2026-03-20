from flask import Flask, request, jsonify
import subprocess
import tempfile
import os

app = Flask(__name__)

@app.route('/compile', methods=['POST'])
def compile():
    data = request.get_json()
    file_name = data.get('fileName', '')
    file_content = data.get('fileContent', '')

    # Determine language by extension
    ext = os.path.splitext(file_name)[1].lower()

    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = os.path.join(tmpdir, file_name)
        with open(file_path, 'w') as f:
            f.write(file_content)

        if ext == '.ts':
            # TypeScript compilation
            result = subprocess.run(
                ['tsc', '--noEmit', file_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode != 0:
                error_output = result.stdout.strip() or result.stderr.strip()
                return jsonify({
                    'hasError': True,
                    'compilerError': error_output
                })
            else:
                return jsonify({
                    'hasError': False,
                    'compilerError': None
                })

        elif ext in ('.cpp', '.cc', '.cxx', '.c'):
            output_path = os.path.join(tmpdir, 'a.out')
            result = subprocess.run(
                ['g++', '-o', output_path, file_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode != 0:
                error_output = result.stderr.strip() or result.stdout.strip()
                return jsonify({
                    'hasError': True,
                    'compilerError': error_output
                })
            else:
                return jsonify({
                    'hasError': False,
                    'compilerError': None
                })
        else:
            return jsonify({
                'hasError': True,
                'compilerError': f'Unsupported file extension: {ext}'
            })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)